-- ============================================================================
-- Migration 071 — two corrections to the game engine, before it has ever run
--
-- 1. `config_text` did not exist. The config helpers were config_bool,
--    config_int, config_decimal and config_allowed_values — every setting so
--    far had been one of those. `game_plays_combine_mode` is the first free
--    text setting, so the helper is added here rather than the function
--    reaching into `app_config` itself and inventing a second way to read a
--    setting.
--
-- 2. THE DRAW NO LONGER USES A TEMPORARY TABLE. `play_game` is SECURITY
--    DEFINER with `search_path = ''`, and an unqualified temp table in that
--    context is exactly the shape of a search-path hijack: pg_temp is not on
--    the path, and a schema-qualified name cannot address a temp table. Even
--    setting the resolution question aside, a caller-controlled schema is the
--    wrong place for a function that mints points to keep its working set.
--    The eligible rows now come from `game_eligible_prizes`, an ordinary
--    stable function, and the running total is a window over it.
--
-- Nobody has played a game yet — `games_enabled` has been false since it was
-- created — so this corrects the engine rather than changing behaviour.
-- ============================================================================


create or replace function public.config_text(p_key text)
returns text
language sql
stable
set search_path = ''
as $$ select value from public.app_config where key = p_key $$;

comment on function public.config_text(text) is
  'Raw text value of a setting. The typed helpers (config_bool/int/decimal) are preferred; this is for settings whose value is a word, like game_plays_combine_mode.';


-- ---------------------------------------------------------------------------
-- game_eligible_prizes — the rows a draw may land on, right now
-- ---------------------------------------------------------------------------
--
-- Split out so the total and the pick read from ONE definition of eligible.
-- When those two disagree — and they would, sooner or later, if the predicate
-- were written twice — the roll can exceed the last cumulative weight and the
-- draw silently returns nothing.

create or replace function public.game_eligible_prizes(
  p_game public.game_kind,
  p_week date
)
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
        where g.prize_id = p.id and g.week_start = p_week
     ) < p.weekly_cap)
   order by p.slot
$$;



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

  select coalesce(sum(p.extra_plays_awarded), 0) into v_extra
    from public.game_plays p
   where p.user_id = p_user_id
     and p.week_start = public.game_week_start();

  return coalesce(v_base, v_free) + v_extra;
end;
$$;


create or replace function public.play_game(
  p_user_id uuid,
  p_game    public.game_kind
)
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
   where user_id = p_user_id and week_start = v_week;

  if v_used >= v_allowance then
    return jsonb_build_object(
      'outcome', 'no_plays_left',
      'allowance', v_allowance,
      'week_ends_at', (v_week + 7)::timestamptz
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

revoke execute on function public.play_game(uuid, public.game_kind)
  from public, anon, authenticated;
