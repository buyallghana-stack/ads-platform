-- ============================================================================
-- Migration 033 — Active sessions
--
-- Lets a user see where they are signed in and sign a device out remotely —
-- the "someone else has my phone" recovery path, and the last item in the
-- Profile security group.
--
-- The data already exists in auth.sessions; it is simply not reachable from
-- PostgREST. These functions expose exactly the caller's OWN rows and nothing
-- else. They are SECURITY DEFINER (auth.sessions is not readable by the
-- authenticated role) but self-scoped by auth.uid(), so unlike the money and
-- 2FA functions they are safe to grant to clients directly.
--
-- `session_id` is a standard claim in a Supabase access token, so the current
-- session identifies itself — no need for the app to pass in something a
-- caller could lie about.
--
-- LIMIT, stated plainly because the UI must not overpromise: revoking a
-- session deletes its refresh token, so the device can never renew. Its
-- CURRENT access token remains valid until it expires (one hour by default).
-- Sign-out is therefore immediate for anything that re-authenticates, and up
-- to an hour for a tab already holding a live token.
-- ============================================================================

create or replace function public.get_active_sessions()
returns table (
  id         uuid,
  created_at timestamptz,
  last_seen  timestamptz,
  user_agent text,
  ip         text,
  is_current boolean
)
language sql
security definer
set search_path to ''
as $$
  select s.id,
         s.created_at,
         coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as last_seen,
         s.user_agent,
         host(s.ip) as ip,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid as is_current
    from auth.sessions s
   where s.user_id = auth.uid()
     and (s.not_after is null or s.not_after > now())
   order by is_current desc, last_seen desc;
$$;


/**
 * Sign one device out. Refuses the caller's own session: that is what the
 * Log out button is for, and silently ending your own session from a list of
 * other devices is a confusing way to be signed out.
 */
create or replace function public.revoke_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user    uuid := auth.uid();
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_deleted int;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_session_id = v_current then
    raise exception 'Use log out to end the current session' using errcode = 'check_violation';
  end if;

  delete from auth.sessions
   where id = p_session_id and user_id = v_user;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;


/** Sign out everywhere except here. */
create or replace function public.revoke_other_sessions()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user    uuid := auth.uid();
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_deleted int;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  delete from auth.sessions
   where user_id = v_user
     and (v_current is null or id <> v_current);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


-- Self-scoped by auth.uid(), so these are client-callable.
grant execute on function public.get_active_sessions()    to authenticated;
grant execute on function public.revoke_session(uuid)     to authenticated;
grant execute on function public.revoke_other_sessions()  to authenticated;
