-- =============================================================================
-- Game plays are a DAILY allowance, not a weekly one
-- =============================================================================
--
-- OPERATOR, 2026-09-28: "make it daily instead of weekly". A plan's plays now
-- arrive every day at 00:00 UTC (midnight in Ghana) and unused ones are gone
-- the next day, exactly as the weekly ones were gone on Monday. Plays won as
-- prizes ride on the same clock: an extra play won today is spent today.
--
-- WHAT IS NOT MOVING, AND WHY THE COLUMN NAMES STAY.
--
--   * `tiers.weekly_game_plays` keeps its name and now means plays A DAY.
--     Renaming it touches the admin, the onboarding plan cards, the types and
--     every verify script for no change in behaviour; the name is wrong, the
--     number is right, and this comment is where the next reader finds out.
--   * `game_plays.week_start` keeps meaning the MONDAY of the play. It is
--     still written by `play_game` and still read by nothing that counts
--     plays; the daily count reads `created_at` instead. Storing the day in a
--     column called week_start would have quietly turned every prize's
--     WEEKLY CAP into a daily one, and the caps are the only thing bounding
--     prize liability (see scripts/apply-game-plays.mjs).
--   * Prize `weekly_cap` stays a calendar week. It was compared against
--     `week_start`; it now reads `created_at` from the start of the week, the
--     same way `daily_cap` already read from the start of the day. Same
--     answer, and it no longer depends on what `week_start` holds.
--   * `game_status_for` keeps its column names (`week_start`, `week_ends_at`)
--     so the app's reader does not change shape. They now carry the START OF
--     TODAY and the moment today's plays are forfeited.
--
-- ⚠️ THIS MULTIPLIES PRIZE LIABILITY BY UP TO SEVEN. A member who drew 10 a
-- week now draws 10 a day. Every face pays something (operator rule 4), so the
-- prize table's daily and weekly caps are the only brake; read them on the
-- admin games screen before turning the games on.
--
-- The switch-over day: plays made earlier today still count against today,
-- plays made earlier this week do not. Nobody loses a play.
-- =============================================================================

-- The start of the current play period. UTC is Ghana's time all year.
create or replace function public.game_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select date_trunc('day', now()) $$;

revoke all on function public.game_day_start() from public, anon;
grant execute on function public.game_day_start() to authenticated, service_role;

-- A user's plays today, found without the week column.
create index if not exists game_plays_user_created_idx
  on public.game_plays (user_id, created_at desc);


-- -----------------------------------------------------------------------------
-- user_weekly_play_allowance: the name is historical, the allowance is daily
-- -----------------------------------------------------------------------------
create or replace function public.user_weekly_play_allowance(p_user_id uuid)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_mode  text := coalesce(public.config_text('game_plays_combine_mode'), 'highest');
  v_free  int;
  v_base  int;
  v_extra int;
begin
  select t.weekly_game_plays into v_free
    from public.tiers t where t.is_default limit 1;
  v_free := coalesce(v_free, 1);

  if v_mode = 'sum_bonus' then
    select v_free + coalesce(sum(greatest(t.weekly_game_plays - v_free, 0)), 0)
      into v_base
      from public.user_target_tiers(p_user_id) ut
      join public.tiers t on t.id = ut.tier_id
     where not t.is_default;
  else
    select coalesce(max(t.weekly_game_plays), v_free)
      into v_base
      from public.user_target_tiers(p_user_id) ut
      join public.tiers t on t.id = ut.tier_id;
  end if;

  -- Extra plays won as prizes count for the day they were won.
  select coalesce(sum(p.extra_plays_awarded), 0) into v_extra
    from public.game_plays p
   where p.user_id = p_user_id
     and p.created_at >= public.game_day_start();

  return coalesce(v_base, v_free) + v_extra;
end;
$$;


-- -----------------------------------------------------------------------------
-- game_eligible_prizes: the weekly cap reads the clock, not week_start
-- -----------------------------------------------------------------------------
-- `p_week` is kept so the signature (and every caller) is unchanged; nothing
-- reads it any more.
create or replace function public.game_eligible_prizes(p_game public.game_kind, p_week date)
returns setof public.game_prizes
language sql
stable
set search_path = ''
as $$
  select p.*
    from public.game_prizes p
   where p.game = p_game
     and p.is_active
     and p.weight > 0
     and (p.daily_cap = 0 or (
       select count(*) from public.game_plays g
        where g.prize_id = p.id and g.created_at >= date_trunc('day', now())
     ) < p.daily_cap)
     and (p.weekly_cap = 0 or (
       select count(*) from public.game_plays g
        where g.prize_id = p.id and g.created_at >= date_trunc('week', now())
     ) < p.weekly_cap)
   order by p.slot
$$;


-- -----------------------------------------------------------------------------
-- game_status_for: today's plays, and when they run out
-- -----------------------------------------------------------------------------
create or replace function public.game_status_for(p_user_id uuid)
returns table(enabled boolean, allowance integer, used integer, remaining integer, week_start date, week_ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_start timestamptz := public.game_day_start();
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
      where g.user_id = p_user_id and g.created_at >= v_start),
    greatest(
      public.user_weekly_play_allowance(p_user_id)
        - (select count(*)::int from public.game_plays g
            where g.user_id = p_user_id and g.created_at >= v_start),
      0),
    v_start::date,
    -- The moment unused plays are forfeited: tomorrow, 00:00 UTC.
    v_start + interval '1 day';
end;
$$;


-- -----------------------------------------------------------------------------
-- play_game: count today's plays; everything else is unchanged
-- -----------------------------------------------------------------------------
create or replace function public.play_game(p_user_id uuid, p_game public.game_kind)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile   public.profiles;
  v_allowance int;
  v_used      int;
  v_week      date := public.game_week_start();
  v_day       timestamptz := public.game_day_start();
  v_total     bigint;
  v_roll      bigint;
  v_bytes     bytea;
  v_prize_id  uuid;
  v_prize     public.game_prizes;
  v_play_id   uuid;
  v_gap       int := coalesce(public.config_int('game_min_seconds_between_plays')::int, 3);
  v_last      timestamptz;
begin
  if not coalesce(public.config_bool('games_enabled'), false) then
    return jsonb_build_object('outcome', 'games_disabled');
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_profile.disabled_at is not null then
    return jsonb_build_object('outcome', 'account_disabled');
  end if;

  /*
    Serialise this user's plays. Without the lock two requests a millisecond
    apart both read the same "used" count and both play, which on the last
    remaining play means one play spent and two prizes paid.
  */
  perform 1 from public.profiles where id = p_user_id for update;

  select max(created_at) into v_last
    from public.game_plays where user_id = p_user_id;
  if v_gap > 0 and v_last is not null and v_last > now() - make_interval(secs => v_gap) then
    return jsonb_build_object('outcome', 'too_soon');
  end if;

  v_allowance := public.user_weekly_play_allowance(p_user_id);
  select count(*)::int into v_used
    from public.game_plays
   where user_id = p_user_id and created_at >= v_day;

  if v_used >= v_allowance then
    return jsonb_build_object(
      'outcome', 'no_plays_left',
      'allowance', v_allowance,
      'week_ends_at', v_day + interval '1 day'
    );
  end if;

  select coalesce(sum(weight), 0) into v_total
    from public.game_eligible_prizes(p_game, v_week);

  if v_total = 0 then
    /*
      Every prize is capped out, or none is configured. A play must still pay
      something (operator rule 4) and silently spending somebody's play on
      nothing would be the worst possible answer — so the caps are ignored for
      the CHEAPEST active prize rather than the draw failing.
    */
    select * into v_prize
      from public.game_prizes
     where game = p_game and is_active
     order by points asc, extra_plays asc, slot asc
     limit 1;

    if not found then
      return jsonb_build_object('outcome', 'no_prizes_configured');
    end if;

    v_roll := 0;
    v_total := 1;
  else
    /*
      Six bytes from the CSPRNG: always positive, up to ~2.8e14, so the
      modulo bias against a total weight in the millions is not measurable.
      `random()` is a seeded PRNG and this decides who gets paid — the same
      argument that made gift codes use gen_random_bytes.
    */
    v_bytes := extensions.gen_random_bytes(6);
    v_roll := ((get_byte(v_bytes, 0)::bigint << 40)
             | (get_byte(v_bytes, 1)::bigint << 32)
             | (get_byte(v_bytes, 2)::bigint << 24)
             | (get_byte(v_bytes, 3)::bigint << 16)
             | (get_byte(v_bytes, 4)::bigint << 8)
             |  get_byte(v_bytes, 5)::bigint) % v_total;

    select e.id into v_prize_id
      from (
        select p.id,
               sum(p.weight) over (order by p.slot rows between unbounded preceding and current row) as cum
          from public.game_eligible_prizes(p_game, v_week) p
      ) e
     where e.cum > v_roll
     order by e.cum asc
     limit 1;

    select * into v_prize from public.game_prizes where id = v_prize_id;

    if not found then
      raise exception 'Draw found no prize for roll % of %', v_roll, v_total
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.game_plays
    (user_id, game, prize_id, slot, points_awarded, extra_plays_awarded,
     roll, weight_total, week_start)
  values
    (p_user_id, p_game, v_prize.id, v_prize.slot, v_prize.points,
     v_prize.extra_plays, v_roll, v_total, v_week)
  returning id into v_play_id;

  if v_prize.points > 0 then
    perform public.credit_points(
      p_user_id, v_prize.points, 'game_prize', 'game_play', v_play_id::text,
      jsonb_build_object('game', p_game, 'label', v_prize.label, 'slot', v_prize.slot)
    );
  end if;

  return jsonb_build_object(
    'outcome', 'ok',
    'play_id', v_play_id,
    'slot', v_prize.slot,
    'label', v_prize.label,
    'points', v_prize.points,
    'extra_plays', v_prize.extra_plays,
    'remaining', greatest(public.user_weekly_play_allowance(p_user_id) - (v_used + 1), 0)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- admin_list_game_prizes: "won this week" reads the clock too
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_game_prizes(p_admin_id uuid, p_game public.game_kind)
returns table(id uuid, slot integer, label text, points bigint, extra_plays integer, weight integer, colour text, daily_cap integer, weekly_cap integer, is_active boolean, chance_percent numeric, won_today bigint, won_this_week bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint;
begin
  perform public.assert_admin(p_admin_id);

  select coalesce(sum(p.weight), 0) into v_total
    from public.game_prizes p
   where p.game = p_game and p.is_active;

  return query
  select p.id, p.slot, p.label, p.points, p.extra_plays, p.weight, p.colour,
         p.daily_cap, p.weekly_cap, p.is_active,
         case when v_total = 0 or not p.is_active then 0::numeric
              else round((p.weight::numeric * 100) / v_total, 2) end,
         (select count(*) from public.game_plays g
           where g.prize_id = p.id and g.created_at >= date_trunc('day', now())),
         (select count(*) from public.game_plays g
           where g.prize_id = p.id and g.created_at >= date_trunc('week', now()))
    from public.game_prizes p
   where p.game = p_game
   order by p.slot;
end;
$$;


-- -----------------------------------------------------------------------------
-- admin_set_tier_game_plays: only the wording changes
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_tier_game_plays(p_admin_id uuid, p_tier_id uuid, p_plays integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plays int;
begin
  perform public.assert_admin(p_admin_id);

  if p_plays is null or p_plays < 0 or p_plays > 100 then
    raise exception 'Daily plays must be between 0 and 100'
      using errcode = 'check_violation';
  end if;

  update public.tiers
     set weekly_game_plays = p_plays
   where id = p_tier_id
  returning weekly_game_plays into v_plays;

  if not found then
    raise exception 'No such plan' using errcode = 'check_violation';
  end if;

  return v_plays;
end;
$$;

comment on column public.tiers.weekly_game_plays is
  'Game plays A DAY granted by this plan (daily since 2026-09-28; the name is historical).';
