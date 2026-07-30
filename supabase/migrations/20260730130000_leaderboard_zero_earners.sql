-- ============================================================================
-- Migration 068 — let the operator choose whether people on zero appear
--
-- The board showed 2 of 4 live accounts and the operator asked why. It was
-- working as built: the other two have never watched an ad, taken a survey,
-- been referred or redeemed a code — zero ledger rows between them — and the
-- board only ranked people above zero. They chose to make it a setting rather
-- than a rule, defaulting to the current behaviour.
--
-- WHY `having sum(...) > 0` COULD NOT SIMPLY BE RELAXED. An account with no
-- ledger rows at all never appears in the aggregate, so there is nothing for a
-- HAVING clause to keep. Showing them means starting from the list of live
-- people and LEFT JOINing their points, which is what these rewrites do. The
-- filtered case comes out identical to before — the same rows, the same ranks
-- — it is just now expressed as a condition rather than as an inner join.
--
-- `prev` gets the same treatment as `cur`, deliberately: if the previous
-- period excluded zero-earners while the current one included them, everybody
-- on zero would read as "new on the board" forever, and an arrow that is
-- always the same arrow is worse than no arrow.
--
-- Deleted and disabled accounts are STILL excluded in both modes. This
-- setting is about people who have not earned yet, never about people the
-- operator has removed or suspended — those must not reappear because a
-- display toggle was flipped.
-- ============================================================================


insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('leaderboard_shows_zero_earners', 'false', 'bool', null, null, false,
   'Whether accounts that have not earned any points in the period appear on the leaderboard. Off by default: with thousands of signups, most of whom never watch an ad, a long tail of ties on zero buries the real ranking. Someone not shown still sees their own "not ranked yet" message. Deleted and disabled accounts are excluded either way.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- get_leaderboard
-- ---------------------------------------------------------------------------

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
  v_zeros  boolean := coalesce(public.config_bool('leaderboard_shows_zero_earners'), false);
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
    select live.id as user_id,
           coalesce(sum(c.amount), 0)::bigint as pts,
           min(c.created_at) as first_at
      from live
      left join counted c
        on c.user_id = live.id
       and c.created_at >= v_bounds.cur_start
     group by live.id
    having v_zeros or coalesce(sum(c.amount), 0) > 0
  ),
  prev as (
    select live.id as user_id,
           coalesce(sum(c.amount), 0)::bigint as pts
      from live
      left join counted c
        on c.user_id = live.id
       and c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by live.id
    having v_zeros or coalesce(sum(c.amount), 0) > 0
  ),
  cur_ranked as (
    select cur.user_id, cur.pts, cur.first_at, rank() over (order by cur.pts desc) as rnk
      from cur
  ),
  prev_ranked as (
    select prev.user_id, rank() over (order by prev.pts desc) as rnk
      from prev
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

/* CREATE OR REPLACE does not carry these forward — the lesson from migration
   066. Restated and re-verified rather than remembered. */
revoke execute on function public.get_leaderboard(text, int) from public, anon;
grant execute on function public.get_leaderboard(text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- get_leaderboard_standing
-- ---------------------------------------------------------------------------

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
  v_zeros  boolean := coalesce(public.config_bool('leaderboard_shows_zero_earners'), false);
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
    select live.id as user_id, coalesce(sum(c.amount), 0)::bigint as pts
      from live
      left join counted c
        on c.user_id = live.id
       and c.created_at >= v_bounds.cur_start
     group by live.id
    having v_zeros or coalesce(sum(c.amount), 0) > 0
  ),
  prev as (
    select live.id as user_id, coalesce(sum(c.amount), 0)::bigint as pts
      from live
      left join counted c
        on c.user_id = live.id
       and c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by live.id
    having v_zeros or coalesce(sum(c.amount), 0) > 0
  ),
  cur_ranked as (
    select cur.user_id, cur.pts, rank() over (order by cur.pts desc) as rnk from cur
  ),
  prev_ranked as (
    select prev.user_id, rank() over (order by prev.pts desc) as rnk from prev
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
-- admin_get_leaderboard
-- ---------------------------------------------------------------------------

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
  v_zeros  boolean := coalesce(public.config_bool('leaderboard_shows_zero_earners'), false);
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
    select live.id as user_id,
           coalesce(sum(c.amount), 0)::bigint as pts,
           min(c.created_at) as first_at
      from live
      left join counted c
        on c.user_id = live.id
       and c.created_at >= v_bounds.cur_start
     group by live.id
    having v_zeros or coalesce(sum(c.amount), 0) > 0
  ),
  prev as (
    select live.id as user_id, coalesce(sum(c.amount), 0)::bigint as pts
      from live
      left join counted c
        on c.user_id = live.id
       and c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by live.id
    having v_zeros or coalesce(sum(c.amount), 0) > 0
  ),
  cur_ranked as (
    select cur.user_id, cur.pts, cur.first_at, rank() over (order by cur.pts desc) as rnk
      from cur
  ),
  prev_ranked as (
    select prev.user_id, rank() over (order by prev.pts desc) as rnk from prev
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
