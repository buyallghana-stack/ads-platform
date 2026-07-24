-- ============================================================================
-- Migration 026 — Notifications
--
-- In-app notifications: a bell + unread badge, and a list of typed, colour-
-- coded cards. Three types, matching the operator's spec:
--   announcement -> yellow, informational
--   payout       -> green, a redemption moved forward
--   flag         -> red, the account was flagged for suspicious activity;
--                   carries a "Contact support" action and, unlike the others,
--                   CANNOT be cleared by the user (security-critical).
--
-- "Clearable" is not a user choice — it is a property of the type, so it is a
-- GENERATED column (flag is never clearable). "Read all" and "Clear all" are
-- set operations exposed as SECURITY DEFINER functions scoped to the caller,
-- so the "flags survive Clear all" rule is enforced in the database and cannot
-- be bypassed by a hand-crafted delete.
--
-- Rows are CREATED only by trusted server code: the admin surface
-- (announcements, and the flagging flow that sets profiles.disabled_*) and the
-- redemption pipeline (payout notices). create_notification is therefore
-- revoked from every client role, like the other privileged functions.
--
-- UI is designed and built as a follow-up (design-first, per the operator
-- standard) — this migration is the data layer it will read.
--
-- Applied to the live project via the Supabase MCP on 2026-07-24; this file is
-- the repo record of that change.
-- ============================================================================

create type public.notification_type as enum ('announcement', 'payout', 'flag');


create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,

  type  public.notification_type not null,
  title text not null,
  body  text not null,

  -- Optional structured pointer to what the notification is about (e.g.
  -- {"redemption_id": "…"} for a payout, {"reason": "…"} for a flag). Kept
  -- loose on purpose so new notification sources need no schema change.
  reference jsonb,

  -- Null until the user has seen it; drives the unread badge count.
  read_at timestamptz,

  -- Derived from type, never set by hand: flags are security-critical and must
  -- survive "Clear all", everything else is clearable.
  is_clearable boolean generated always as (type <> 'flag') stored,

  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per-user in-app notifications (announcement/payout/flag). Read via RLS (own or admin); created only by server code through create_notification; mutated by the scoped read/clear functions. Flag notifications are never clearable.';

-- The feed: a user''s notifications newest-first.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- The badge: cheap count of unread per user.
create index notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;


alter table public.notifications enable row level security;

-- Users read their own; admins read all (for support / auditing). No client
-- INSERT/UPDATE/DELETE policies: creation is server-only and the read/clear
-- mutations go through the scoped functions below.
create policy "Read own notifications or all as admin"
  on public.notifications for select
  using ((( select auth.uid() ) = user_id) or public.is_admin());


-- --------------------------------------------------------------------------
-- Creation — server-only. Called by the admin service client (announcements,
-- flagging) and the redemption pipeline (payouts).
-- --------------------------------------------------------------------------
create or replace function public.create_notification(
  p_user_id   uuid,
  p_type      public.notification_type,
  p_title     text,
  p_body      text,
  p_reference jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.notifications (user_id, type, title, body, reference)
  values (p_user_id, p_type, p_title, p_body, p_reference)
  returning id into v_id;
  return v_id;
end;
$$;


-- --------------------------------------------------------------------------
-- User actions — scoped to the caller via auth.uid(), so a client may call
-- them directly and can only ever touch its own rows.
-- --------------------------------------------------------------------------

-- "Read all": clear the badge.
create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications
     set read_at = now()
   where user_id = ( select auth.uid() ) and read_at is null;
$$;

-- Mark a single notification read (opening one card).
create or replace function public.mark_notification_read(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.notifications
     set read_at = now()
   where id = p_id and user_id = ( select auth.uid() ) and read_at is null;
$$;

-- "Clear all": remove everything EXCEPT flags, which must persist.
create or replace function public.clear_notifications()
returns void language sql security definer set search_path = '' as $$
  delete from public.notifications
   where user_id = ( select auth.uid() ) and is_clearable;
$$;


-- Server-only creation; user actions are self-scoping so authenticated may run
-- them (anon cannot — auth.uid() is null).
revoke execute on function public.create_notification(uuid, public.notification_type, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.mark_all_notifications_read() from public, anon;
revoke execute on function public.mark_notification_read(uuid)  from public, anon;
revoke execute on function public.clear_notifications()          from public, anon;
grant  execute on function public.mark_all_notifications_read() to authenticated;
grant  execute on function public.mark_notification_read(uuid)  to authenticated;
grant  execute on function public.clear_notifications()          to authenticated;
