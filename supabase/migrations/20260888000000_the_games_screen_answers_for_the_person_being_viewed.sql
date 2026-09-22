-- ============================================================================
-- Migration 188 — the games screen answers for the person being VIEWED
--
-- REPORTED 2026-09-22: an admin looked at a free account through "view as
-- user" and it showed THREE plays. The free plan grants none. Then the admin
-- played their own three, and the free account's three "vanished". It was
-- never that account's number: both screens were printing the ADMIN's.
--
-- WHY. `get_game_status()` takes no user id and answers for `auth.uid()`.
-- Under "view as user" the admin keeps their own Supabase session on purpose
-- (see `lib/admin/view-as.ts`), so auth.uid() is the ADMIN the whole time.
-- Every other screen in the (app) group renders `getViewerUser()` — the
-- person being looked at — and passes that id down. Games was the one screen
-- that never took an id at all, so there was nothing to pass and nothing to
-- get wrong until somebody looked.
--
-- ⚠️ THE SHAPE OF THIS BUG IS NOT UNIQUE TO GAMES. Any SECURITY DEFINER read
-- that resolves its own subject from `auth.uid()` is unviewable by
-- construction: it cannot answer for anybody but the caller, so it answers for
-- the admin and looks plausible. A user-facing read takes the user as an
-- ARGUMENT. `get_user_earning_status`, `user_ad_allowances` and the rest
-- already do.
--
-- The guard is the same one those functions carry: you may ask about yourself,
-- and staff may ask about anybody. It is not "read-only because the middleware
-- says so" — this function mints nothing, and `play_game` still takes the real
-- signed-in admin from `getSessionUser()`, so a play made while viewing spends
-- the ADMIN's play and always did.
-- ============================================================================

create or replace function public.game_status_for(p_user_id uuid)
returns table (
  enabled         boolean,
  allowance       integer,
  used            integer,
  remaining       integer,
  week_start      date,
  week_ends_at    timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  if p_user_id is null then
    raise exception 'No user' using errcode = 'check_violation';
  end if;

  if p_user_id <> v_me and not public.is_admin() then
    raise exception 'Not allowed' using errcode = 'check_violation';
  end if;

  return query
  select
    coalesce(public.config_bool('games_enabled'), false),
    public.user_weekly_play_allowance(p_user_id),
    (select count(*)::int from public.game_plays g
      where g.user_id = p_user_id and g.week_start = public.game_week_start()),
    greatest(
      public.user_weekly_play_allowance(p_user_id)
        - (select count(*)::int from public.game_plays g
            where g.user_id = p_user_id and g.week_start = public.game_week_start()),
      0),
    public.game_week_start(),
    -- The moment unused plays are forfeited: next Monday, 00:00 UTC.
    (public.game_week_start() + 7)::timestamptz;
end;
$$;

comment on function public.game_status_for(uuid) is
  'Weekly play allowance, spent and remaining for one user. Takes the subject as an argument so an admin viewing somebody''s screens sees THEIR number, not their own. You may ask about yourself; staff may ask about anybody.';

-- ⚠️ A NEW function is granted EXECUTE to PUBLIC by default, which is the
-- anon key. Revoke first, then grant, exactly as the rest of this schema does.
revoke execute on function public.game_status_for(uuid) from public, anon;
grant  execute on function public.game_status_for(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The old no-argument read stays, as one line over the new one
-- ---------------------------------------------------------------------------
--
-- Kept rather than dropped: dropping a function re-opens nothing here, but it
-- would break any caller not in this repository, and "me" is still the honest
-- answer for a signed-in user asking about themselves. It now has exactly one
-- implementation behind it, so the two can no longer disagree.

create or replace function public.get_game_status()
returns table (
  enabled         boolean,
  allowance       integer,
  used            integer,
  remaining       integer,
  week_start      date,
  week_ends_at    timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  return query select * from public.game_status_for((select auth.uid()));
end;
$$;

revoke execute on function public.get_game_status() from public, anon;
grant  execute on function public.get_game_status() to authenticated;
