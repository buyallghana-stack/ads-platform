-- ============================================================================
-- Migration 105 — "View as user": a super admin can look at an account's own
--                 screens, READ ONLY, without a password
--
-- Operator, 2026-08-05: *"I want the function to log in to any users dashboard
-- by just having an option as login as user, however I won't be able to
-- perform any action on their behalf... When I the super admin is login in as
-- a user I don't need no password, but the login needs to happen from me using
-- my dashboard not the general login page."*
--
-- THE SESSION IS NEVER SWAPPED. The admin keeps their own Supabase session
-- throughout. What this creates is a short-lived VIEWING TOKEN that the app
-- reads on the server to decide whose rows to render. The admin never receives
-- the user's credentials, never receives a token that would work at the login
-- page, and nothing here can be replayed into a real sign-in.
--
-- That is the whole reason it is built this way rather than by minting a
-- session for the target with the auth admin API. A real session would make
-- the admin genuinely BE the user — every write path would then be one
-- forgotten check away from an admin moving somebody's money, and "read only"
-- would depend on remembering it in fifty places. Here the app has to opt IN
-- to showing the target's data, and every mutation path continues to see the
-- admin's own identity.
--
-- Four refusals, all enforced here rather than in the screen:
--   1. Only a super admin may start one (`assert_admin`, which is super-admin
--      only — the same gate money operations use).
--   2. NEVER another staff member. Viewing as a fellow admin is a privilege
--      path, not a support tool, and it is the one target that could be used
--      to see another administrator's console.
--   3. Never yourself — that is just the dashboard.
--   4. Never a deleted account.
--
-- The token is generated from `gen_random_bytes`, not `random()`. Postgres's
-- `random()` is a seeded deterministic PRNG; this token is a key to somebody's
-- account view, so it gets the same treatment gift codes got in migration 065.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. How long a look lasts
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, description, value_type, min_value, max_value)
values (
  'admin_view_session_minutes', '30',
  'How long a super admin''s "view as user" session lasts before it expires on its own. Short on purpose: it is a look, not a login.',
  'int', 1, 240
)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The sessions
-- ---------------------------------------------------------------------------

create table if not exists public.admin_view_sessions (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique,
  admin_id       uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  started_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  ended_at       timestamptz,
  constraint admin_view_sessions_not_self check (admin_id <> target_user_id)
);

comment on table public.admin_view_sessions is
  'Short-lived read-only "view as user" sessions opened by a super admin from the admin console. Not an auth session: the admin keeps their own.';

create index if not exists admin_view_sessions_active_idx
  on public.admin_view_sessions (admin_id) where ended_at is null;

alter table public.admin_view_sessions enable row level security;

/* No policy is defined, deliberately. Every read goes through the SECURITY
   DEFINER functions below using the service client; with RLS on and no policy,
   a direct client query returns nothing even if a grant were ever added by
   mistake. */


-- ---------------------------------------------------------------------------
-- 3. Starting a look
-- ---------------------------------------------------------------------------

create or replace function public.admin_start_view_session(
  p_admin_id uuid,
  p_target_user_id uuid
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token   text;
  v_minutes int;
  v_expires timestamptz;
  v_email   text;
  v_target  text;
begin
  perform public.assert_admin(p_admin_id);

  if p_target_user_id = p_admin_id then
    raise exception 'That is your own account' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.user_roles r where r.user_id = p_target_user_id) then
    raise exception 'You cannot view as another administrator'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_target_user_id and p.deleted_at is null
  ) then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  /* One look at a time. Opening a second closes the first, so a forgotten
     session cannot sit open behind a new one. */
  update public.admin_view_sessions
     set ended_at = now()
   where admin_id = p_admin_id and ended_at is null;

  v_minutes := coalesce(public.config_int('admin_view_session_minutes'), 30);
  v_expires := now() + make_interval(mins => v_minutes);
  v_token   := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.admin_view_sessions (token, admin_id, target_user_id, expires_at)
  values (v_token, p_admin_id, p_target_user_id, v_expires);

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  select coalesce(p.full_name, u.email::text) into v_target
    from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_target_user_id;

  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, new_values)
  values (
    p_admin_id, v_email, 'view_as_user', 'profiles', p_target_user_id,
    jsonb_build_object('target', v_target, 'expires_at', v_expires, 'read_only', true)
  );

  return query select v_token, v_expires;
end;
$$;

revoke execute on function public.admin_start_view_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_start_view_session(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Ending one
-- ---------------------------------------------------------------------------

create or replace function public.admin_end_view_session(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.admin_view_sessions;
  v_email text;
begin
  update public.admin_view_sessions
     set ended_at = now()
   where token = p_token and ended_at is null
  returning * into v_row;

  if not found then
    return;  -- already ended or never existed; ending is idempotent
  end if;

  select u.email::text into v_email from auth.users u where u.id = v_row.admin_id;

  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, new_values)
  values (
    v_row.admin_id, v_email, 'view_as_user_ended', 'profiles', v_row.target_user_id,
    jsonb_build_object('started_at', v_row.started_at)
  );
end;
$$;

revoke execute on function public.admin_end_view_session(text) from public, anon, authenticated;
grant execute on function public.admin_end_view_session(text) to service_role;


-- ---------------------------------------------------------------------------
-- 5. Resolving one, on every request
-- ---------------------------------------------------------------------------
--
-- Re-checks that the admin is STILL a super admin rather than trusting the
-- session that was opened earlier. A revoked administrator's open look stops
-- working on their next page load, which is the same reasoning `getAdminRole`
-- gives for reading the table instead of the JWT claim.

create or replace function public.admin_active_view_session(p_token text)
returns table (admin_id uuid, target_user_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.admin_id, s.target_user_id, s.expires_at
    from public.admin_view_sessions s
   where s.token = p_token
     and s.ended_at is null
     and s.expires_at > now()
     and public.admin_role(s.admin_id) = 'super_admin'
     and not exists (
       select 1 from public.user_roles r where r.user_id = s.target_user_id
     );
$$;

revoke execute on function public.admin_active_view_session(text) from public, anon, authenticated;
grant execute on function public.admin_active_view_session(text) to service_role;
