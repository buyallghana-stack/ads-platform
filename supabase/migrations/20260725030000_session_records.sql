-- ============================================================================
-- Migration 034 — Accurate device, IP and sign-in time for Active sessions
--
-- WHY THIS EXISTS. auth.sessions records the device and IP of whoever spoke to
-- GoTrue — and since sign-in happens in a Server Action, that is our Vercel
-- function, not the user's phone. Real evidence from production:
--
--     auth.sessions   ip 13.37.225.184  (AWS Paris, Vercel egress)  ua "node"
--     auth_signals    ip 154.161.129.108 (Ghana)  ua "iPhone; CPU iPhone OS 18_7"
--
-- Forwarding User-Agent and X-Forwarded-For from the app does not fix it:
-- Supabase's gateway sets its own, so GoTrue's view cannot be corrected from
-- our side. The fix is to stop asking GoTrue and record the context ourselves
-- at sign-in, from the headers Vercel gives us — which is exactly where
-- auth_signals already gets the values that ARE correct.
--
-- Division of labour after this migration:
--   auth.sessions             -> liveness and last refresh (accurate)
--   public.user_session_records -> device, IP, country, sign-in time (accurate)
-- The sessions screen joins the two.
-- ============================================================================

create table public.user_session_records (
  session_id   uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_agent   text,
  ip           inet,
  country      text,
  signed_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.user_session_records is
  'Device/IP/country captured from the real request at sign-in, keyed by the auth session id. auth.sessions cannot hold this: it only ever sees our server.';

create index user_session_records_user_idx on public.user_session_records (user_id);

alter table public.user_session_records enable row level security;
-- No client policies: reads go through get_active_sessions() below, writes
-- only through the server-only recorder.
revoke all on public.user_session_records from anon, authenticated;


/**
 * Called by the app immediately after a session is created, with the request
 * context of the browser that actually signed in. Server-only — the user id
 * and session id come from the freshly issued token, never from a payload the
 * caller composed.
 */
create or replace function public.record_session_context(
  p_session_id uuid,
  p_user_id    uuid,
  p_user_agent text,
  p_ip         text,
  p_country    text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.user_session_records
    (session_id, user_id, user_agent, ip, country, signed_in_at, last_seen_at)
  values
    (p_session_id, p_user_id, nullif(left(p_user_agent, 500), ''),
     nullif(p_ip, '')::inet, upper(nullif(p_country, '')), now(), now())
  on conflict (session_id) do update
    set user_agent   = coalesce(excluded.user_agent, public.user_session_records.user_agent),
        ip           = coalesce(excluded.ip, public.user_session_records.ip),
        country      = coalesce(excluded.country, public.user_session_records.country),
        last_seen_at = now();
exception
  when others then
    -- Never let bookkeeping break a sign-in.
    null;
end;
$$;


/**
 * Active sessions for the caller. auth.sessions supplies which sessions are
 * live and when each last refreshed; our own record supplies who and where.
 * Rows recorded before this migration have no context and are reported as
 * unknown rather than shown with the misleading server values.
 */
create or replace function public.get_active_sessions()
returns table (
  id           uuid,
  signed_in_at timestamptz,
  last_seen    timestamptz,
  user_agent   text,
  ip           text,
  country      text,
  is_current   boolean
)
language sql
security definer
set search_path to ''
as $$
  select s.id,
         coalesce(r.signed_in_at, s.created_at) as signed_in_at,
         coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as last_seen,
         r.user_agent,
         host(r.ip) as ip,
         r.country,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid as is_current
    from auth.sessions s
    left join public.user_session_records r on r.session_id = s.id
   where s.user_id = auth.uid()
     and (s.not_after is null or s.not_after > now())
   order by is_current desc, last_seen desc;
$$;


revoke execute on function public.record_session_context(uuid, uuid, text, text, text)
  from anon, authenticated;
grant execute on function public.get_active_sessions() to authenticated;


-- ---------------------------------------------------------------------------
-- Backfill for sessions that predate this table. auth_signals already recorded
-- the correct device and IP at sign-in — the login action writes it within a
-- second of the session being created — so matching on time recovers the
-- context for sessions already live, rather than showing every existing user
-- "Unknown device" until their next sign-in.
-- ---------------------------------------------------------------------------
insert into public.user_session_records
  (session_id, user_id, user_agent, ip, country, signed_in_at, last_seen_at)
select s.id, s.user_id, sig.user_agent, sig.ip, sig.country, s.created_at, s.created_at
  from auth.sessions s
  cross join lateral (
    select a.user_agent, a.ip, a.country
      from public.auth_signals a
     where a.user_id = s.user_id
       and a.event_type = 'login'
       and abs(extract(epoch from (a.created_at - s.created_at))) < 60
     order by abs(extract(epoch from (a.created_at - s.created_at)))
     limit 1
  ) sig
 where not exists (select 1 from public.user_session_records r where r.session_id = s.id)
   and (s.not_after is null or s.not_after > now())
on conflict (session_id) do nothing;
