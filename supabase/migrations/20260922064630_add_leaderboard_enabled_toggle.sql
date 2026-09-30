-- Applied directly to production on 2026-09-22 (dashboard), recorded here
-- verbatim from supabase_migrations.schema_migrations so the repo matches.

-- 1. New config switch, defaulting to on so nothing changes until you flip it.
insert into public.app_config (key, value, value_type, description, is_public)
values (
  'leaderboard_enabled',
  'true',
  'bool',
  'Whether the leaderboard is visible to users. Off hides it from get_leaderboard and get_leaderboard_standing; admin views are unaffected.',
  false
)
on conflict (key) do nothing;

-- 2. Gate get_leaderboard
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_period text DEFAULT 'all'::text, p_limit integer DEFAULT NULL::integer)
 RETURNS TABLE(rank bigint, user_id uuid, display_name text, avatar_path text, points bigint, previous_rank bigint, movement text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bounds record;
  v_types  public.ledger_entry_type[] := public.leaderboard_counted_types();
  v_zeros  boolean := coalesce(public.config_bool('leaderboard_shows_zero_earners'), false);
  v_limit  int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  if not coalesce(public.config_bool('leaderboard_enabled'), true) then
    raise exception 'Leaderboard is currently unavailable' using errcode = 'check_violation';
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
$function$;

-- 3. Gate get_leaderboard_standing (a user's own rank)
CREATE OR REPLACE FUNCTION public.get_leaderboard_standing(p_period text DEFAULT 'all'::text)
 RETURNS TABLE(rank bigint, points bigint, previous_rank bigint, movement text, total_ranked bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bounds record;
  v_types  public.ledger_entry_type[] := public.leaderboard_counted_types();
  v_zeros  boolean := coalesce(public.config_bool('leaderboard_shows_zero_earners'), false);
  v_me     uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  if not coalesce(public.config_bool('leaderboard_enabled'), true) then
    raise exception 'Leaderboard is currently unavailable' using errcode = 'check_violation';
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
$function$;
