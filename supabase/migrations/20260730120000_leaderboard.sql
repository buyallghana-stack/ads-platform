-- ============================================================================
-- Migration 067 — the leaderboard
--
-- Operator brief, 2026-07-30: rank users by points accumulated, toggled by
-- day / week / month / all time, with 1st-2nd-3rd ranks, an arrow showing
-- recent movement, and a "my rank" jump. Users see names only; the admin sees
-- the same ranking with email and phone attached.
--
-- FOUR DECISIONS THE OPERATOR MADE, and what they mean here:
--
-- 1. WHAT COUNTS: "every credit, including gift codes". So a gift code and an
--    admin adjustment both move the board, which is what they asked for, and
--    `leaderboard_counts_granted_points` exists to turn that off later without
--    a migration if a campaign ever distorts things.
--
--    REFUNDS ARE STILL EXCLUDED, and this is not a departure from that
--    answer — it is what stops the board being farmable. A declined
--    withdrawal returns as a `redemption_refund` CREDIT, so counting it would
--    mean: request 10,000, get declined, gain 10,000 leaderboard points for
--    money you never earned, repeat forever. `redemption_request` is excluded
--    with it, so the pair nets out and withdrawing moves the board in neither
--    direction. A user is ranked on what came IN from the platform, never on
--    what they did with it afterwards.
--
--    `admin_adjustment` is summed SIGNED rather than positive-only: a
--    claw-back has to be able to take a place back, or the board would record
--    points that were taken away.
--
-- 2. MOVEMENT is measured against the END OF THE PREVIOUS PERIOD — this
--    week against last week, today against yesterday, and all-time against
--    where the person stood at the start of today. Computed live from the
--    ledger by ranking the same expression over an earlier window.
--
--    NO SNAPSHOT TABLE AND NO CRON. That is not only frugality: the Vercel
--    plan is Hobby, both of its two cron slots are already spent (deletion
--    purge, FX refresh), and a snapshot job that silently stops running would
--    leave arrows that quietly lie. A derived comparison cannot drift.
--
--    Known and accepted: early in a period the comparison is noisy, because a
--    part-finished week is being ranked against a complete one. That is
--    inherent in "movement since last period" and it self-corrects as the
--    period fills.
--
-- 3. NAMES ARE ABBREVIATED to first name + last initial for other users. The
--    full name never leaves the database on the user-facing path — it is not
--    fetched and hidden in the client, it is not selected at all.
--
-- 4. PERIODS ARE CALENDAR periods, not rolling windows, so a week can
--    actually be won. Ghana is GMT year-round, so `date_trunc` in UTC is the
--    local day/week/month with no timezone argument needed. Postgres weeks
--    start Monday, which is the intended reset.
--
-- WHY THIS IS ONE FUNCTION AND NOT A MATERIALISED VIEW: at four live profiles
-- and ~180 ledger rows the aggregate is trivial, and a view would need
-- refreshing on a schedule we do not have. If the board ever gets slow the
-- fix is an index on (entry_type, created_at) or a rollup table, not a view.
-- ============================================================================


insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('leaderboard_counts_granted_points', 'true', 'bool', null, null, false,
   'Whether gift codes and admin adjustments count towards leaderboard standing. The operator chose yes (2026-07-30) so that every credit a user receives is reflected. Turn off if a gift-code campaign ever distorts the rankings — earned points (ads, surveys, referrals) always count either way.'),
  ('leaderboard_visible_ranks', '100', 'int', 3, 500, true,
   'How many places the public leaderboard shows. A user outside this many still sees their own standing on a pinned row, so the number bounds the page weight, not the fairness.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- leaderboard_display_name — first name + last initial
-- ---------------------------------------------------------------------------
--
-- "Kwame Asante" -> "Kwame A.".  "Ama" -> "Ama".  "  kojo  mensah  " ->
-- "kojo M." (whitespace is collapsed; case is left as the person typed it,
-- because names like "de Souza" are not ours to correct).
--
-- A deleted account's placeholder is 'Deleted user', which would render as
-- "Deleted U." — those rows are filtered out before they get here, but the
-- function is written to be harmless if one ever slips through.

create or replace function public.leaderboard_display_name(p_full_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(trim(p_full_name), '') = '' then 'Someone'
    when array_length(regexp_split_to_array(trim(p_full_name), '\s+'), 1) = 1
      then (regexp_split_to_array(trim(p_full_name), '\s+'))[1]
    else (regexp_split_to_array(trim(p_full_name), '\s+'))[1]
         || ' '
         || upper(left(
              (regexp_split_to_array(trim(p_full_name), '\s+'))[
                array_length(regexp_split_to_array(trim(p_full_name), '\s+'), 1)
              ], 1))
         || '.'
  end;
$$;

comment on function public.leaderboard_display_name(text) is
  'First name plus last initial, for showing one user to another. The full name is never selected on the user-facing leaderboard path.';


-- ---------------------------------------------------------------------------
-- leaderboard_period_bounds — the one definition of a period
-- ---------------------------------------------------------------------------
--
-- Every function below reads its windows from here, so the board, a user's
-- own standing and the admin's copy can never disagree about when a week
-- started. Unknown period text falls back to 'all' rather than raising: this
-- value arrives from a URL tab, and a mistyped one should show a board, not
-- an error page.

create or replace function public.leaderboard_period_bounds(
  p_period    text,
  out cur_start  timestamptz,
  out prev_start timestamptz,
  out prev_end   timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  case lower(coalesce(p_period, 'all'))
    when 'day' then
      cur_start  := date_trunc('day', v_now);
      prev_start := cur_start - interval '1 day';
      prev_end   := cur_start;
    when 'week' then
      cur_start  := date_trunc('week', v_now);
      prev_start := cur_start - interval '1 week';
      prev_end   := cur_start;
    when 'month' then
      cur_start  := date_trunc('month', v_now);
      prev_start := cur_start - interval '1 month';
      prev_end   := cur_start;
    else
      -- All time. "Previously" means where everyone stood when today began,
      -- which is the only comparison that means anything on a board with no
      -- start date.
      cur_start  := '-infinity'::timestamptz;
      prev_start := '-infinity'::timestamptz;
      prev_end   := date_trunc('day', v_now);
  end case;
end;
$$;


-- ---------------------------------------------------------------------------
-- leaderboard_counted_types — which ledger entries build a standing
-- ---------------------------------------------------------------------------

create or replace function public.leaderboard_counted_types()
returns public.ledger_entry_type[]
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(public.config_bool('leaderboard_counts_granted_points'), true)
      then array[
        'ad_view', 'survey',
        'referral_signup', 'referral_activation', 'referral_purchase',
        'gift_code', 'admin_adjustment'
      ]::public.ledger_entry_type[]
    else array[
        'ad_view', 'survey',
        'referral_signup', 'referral_activation', 'referral_purchase'
      ]::public.ledger_entry_type[]
  end;
$$;

comment on function public.leaderboard_counted_types() is
  'Ledger entry types that build a leaderboard standing. redemption_request and redemption_refund are absent by design — counting the refund would let a user farm the board by requesting withdrawals and having them declined.';


-- ---------------------------------------------------------------------------
-- get_leaderboard — the board itself
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER and granted to `authenticated`: the abbreviated name and
-- the point total ARE the public data here, and the function is what makes
-- sure that is all anybody can reach. `profiles` itself stays locked — a user
-- cannot select somebody else's row, and this does not open one.
--
-- Ties take the same rank (1, 1, 3 — competition ranking) and are ordered
-- among themselves by who got there first, so the display is stable between
-- reloads instead of shuffling two equal users.

create or replace function public.get_leaderboard(
  p_period text default 'all',
  p_limit  int  default null
)
returns table (
  rank          bigint,
  user_id       uuid,
  display_name  text,
  avatar_path   text,
  points        bigint,
  previous_rank bigint,
  movement      text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_bounds record;
  v_types  public.ledger_entry_type[] := public.leaderboard_counted_types();
  v_limit  int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  select * into v_bounds from public.leaderboard_period_bounds(p_period);

  v_limit := least(
    coalesce(p_limit, public.config_int('leaderboard_visible_ranks')::int, 100),
    500
  );

  return query
  with live as (
    select p.id, p.full_name, p.avatar_path
      from public.profiles p
     where p.deleted_at is null
       and p.disabled_at is null
  ),
  counted as (
    select l.user_id, l.amount, l.created_at
      from public.points_ledger l
     where l.entry_type = any(v_types)
  ),
  cur as (
    select c.user_id, sum(c.amount)::bigint as pts, min(c.created_at) as first_at
      from counted c
     where c.created_at >= v_bounds.cur_start
     group by c.user_id
    having sum(c.amount) > 0
  ),
  prev as (
    select c.user_id, sum(c.amount)::bigint as pts
      from counted c
     where c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by c.user_id
    having sum(c.amount) > 0
  ),
  cur_ranked as (
    select cur.user_id,
           cur.pts,
           cur.first_at,
           rank() over (order by cur.pts desc) as rnk
      from cur
      join live on live.id = cur.user_id
  ),
  prev_ranked as (
    select prev.user_id,
           rank() over (order by prev.pts desc) as rnk
      from prev
      join live on live.id = prev.user_id
  )
  select
    r.rnk,
    r.user_id,
    public.leaderboard_display_name(live.full_name),
    live.avatar_path,
    r.pts,
    pr.rnk,
    case
      when pr.rnk is null   then 'new'
      when pr.rnk > r.rnk   then 'up'
      when pr.rnk < r.rnk   then 'down'
      else                       'same'
    end
  from cur_ranked r
  join live on live.id = r.user_id
  left join prev_ranked pr on pr.user_id = r.user_id
  order by r.rnk, r.first_at
  limit v_limit;
end;
$$;

revoke execute on function public.get_leaderboard(text, int) from public, anon;
grant execute on function public.get_leaderboard(text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- get_leaderboard_standing — where one person is, however far down
-- ---------------------------------------------------------------------------
--
-- Separate from the board because the "My rank" button has to work for
-- somebody in 4,000th place, and rendering four thousand rows to find them
-- would be the wrong way to do it. The screen pins this row when the user is
-- outside the visible ranks, and scrolls to their row when they are inside.
--
-- Self-scoped by auth.uid() — it takes no user id, so it cannot be used to
-- look up anybody else's standing.

create or replace function public.get_leaderboard_standing(p_period text default 'all')
returns table (
  rank          bigint,
  points        bigint,
  previous_rank bigint,
  movement      text,
  total_ranked  bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_bounds record;
  v_types  public.ledger_entry_type[] := public.leaderboard_counted_types();
  v_me     uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  select * into v_bounds from public.leaderboard_period_bounds(p_period);

  return query
  with live as (
    select p.id from public.profiles p
     where p.deleted_at is null and p.disabled_at is null
  ),
  counted as (
    select l.user_id, l.amount, l.created_at
      from public.points_ledger l
     where l.entry_type = any(v_types)
  ),
  cur as (
    select c.user_id, sum(c.amount)::bigint as pts
      from counted c
     where c.created_at >= v_bounds.cur_start
     group by c.user_id
    having sum(c.amount) > 0
  ),
  prev as (
    select c.user_id, sum(c.amount)::bigint as pts
      from counted c
     where c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by c.user_id
    having sum(c.amount) > 0
  ),
  cur_ranked as (
    select cur.user_id, cur.pts, rank() over (order by cur.pts desc) as rnk
      from cur join live on live.id = cur.user_id
  ),
  prev_ranked as (
    select prev.user_id, rank() over (order by prev.pts desc) as rnk
      from prev join live on live.id = prev.user_id
  )
  select
    r.rnk,
    r.pts,
    pr.rnk,
    case
      when pr.rnk is null then 'new'
      when pr.rnk > r.rnk then 'up'
      when pr.rnk < r.rnk then 'down'
      else                     'same'
    end,
    (select count(*) from cur_ranked)
  from cur_ranked r
  left join prev_ranked pr on pr.user_id = r.user_id
  where r.user_id = v_me;
end;
$$;

revoke execute on function public.get_leaderboard_standing(text) from public, anon;
grant execute on function public.get_leaderboard_standing(text) to authenticated;


-- ---------------------------------------------------------------------------
-- admin_get_leaderboard — the same ranking, with the person attached
-- ---------------------------------------------------------------------------
--
-- The operator asked for the identical table plus name, email and phone. It
-- is a SEPARATE function rather than a flag on `get_leaderboard`, because a
-- boolean that switches on personal data is one wrong argument away from
-- serving it to a user. This one cannot be reached from a user session at
-- all: revoked from `authenticated`, and `assert_admin` re-checks the acting
-- admin, since it runs through the service client where auth.uid() is null.
--
-- Ranks come from exactly the same expression as the public board — the
-- admin is looking at what the users are looking at, not a second opinion.

create or replace function public.admin_get_leaderboard(
  p_admin_id uuid,
  p_period   text default 'all',
  p_limit    int  default 200
)
returns table (
  rank          bigint,
  user_id       uuid,
  display_name  text,
  full_name     text,
  email         text,
  phone         text,
  avatar_path   text,
  points        bigint,
  previous_rank bigint,
  movement      text,
  flagged       boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_bounds record;
  v_types  public.ledger_entry_type[] := public.leaderboard_counted_types();
begin
  perform public.assert_admin(p_admin_id);

  select * into v_bounds from public.leaderboard_period_bounds(p_period);

  return query
  with live as (
    select p.id, p.full_name, p.phone, p.avatar_path, p.flagged_at
      from public.profiles p
     where p.deleted_at is null
       and p.disabled_at is null
  ),
  counted as (
    select l.user_id, l.amount, l.created_at
      from public.points_ledger l
     where l.entry_type = any(v_types)
  ),
  cur as (
    select c.user_id, sum(c.amount)::bigint as pts, min(c.created_at) as first_at
      from counted c
     where c.created_at >= v_bounds.cur_start
     group by c.user_id
    having sum(c.amount) > 0
  ),
  prev as (
    select c.user_id, sum(c.amount)::bigint as pts
      from counted c
     where c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by c.user_id
    having sum(c.amount) > 0
  ),
  cur_ranked as (
    select cur.user_id, cur.pts, cur.first_at, rank() over (order by cur.pts desc) as rnk
      from cur join live on live.id = cur.user_id
  ),
  prev_ranked as (
    select prev.user_id, rank() over (order by prev.pts desc) as rnk
      from prev join live on live.id = prev.user_id
  )
  select
    r.rnk,
    r.user_id,
    public.leaderboard_display_name(live.full_name),
    live.full_name,
    u.email::text,
    live.phone,
    live.avatar_path,
    r.pts,
    pr.rnk,
    case
      when pr.rnk is null then 'new'
      when pr.rnk > r.rnk then 'up'
      when pr.rnk < r.rnk then 'down'
      else                     'same'
    end,
    live.flagged_at is not null
  from cur_ranked r
  join live on live.id = r.user_id
  join auth.users u on u.id = r.user_id
  left join prev_ranked pr on pr.user_id = r.user_id
  order by r.rnk, r.first_at
  limit least(coalesce(p_limit, 200), 1000);
end;
$$;

revoke execute on function public.admin_get_leaderboard(uuid, text, int)
  from public, anon, authenticated;


-- The board reads every counted entry for a window on each call. This is the
-- index that keeps that a range scan rather than a sequential one as the
-- ledger grows.
create index if not exists points_ledger_leaderboard_idx
  on public.points_ledger (entry_type, created_at, user_id)
  include (amount);
