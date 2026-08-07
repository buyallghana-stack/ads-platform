-- ---------------------------------------------------------------------------
-- The affiliate prize tables become the ads prize tables, in cedis.
--
-- Operator, 2026-08-07: twelve prizes on each game, copying the ads earning
-- structure, "but make sure the points 100 to GHS 1 is done right before
-- duplicating".
--
-- ── THE CONVERSION, CHECKED FIRST ──
--
-- `points_per_currency_unit` is 100, so GHS 1 is 100 points. A cedi is also
-- 100 pesewas. Therefore ONE POINT AND ONE PESEWA ARE THE SAME SIZE, and the
-- conversion is 1:1: a 300-point prize becomes 300 pesewas, which is GHS 3.00.
-- That is why the amounts below are the ads figures unchanged, and it is worth
-- stating because it looks like no conversion happened at all.
--
-- ⚠️ It is a ONE-TIME conversion at today's peg. If the peg is ever retuned,
-- these amounts do not follow it: they are cedis now, and cedis are not
-- pegged to anything.
--
-- ── AND THE CAPS, WHICH ARE HALF OF WHAT "EARNING STRUCTURE" MEANS ──
--
-- Slots 11 and 12 are the big ones, and on the ads side they are rationed:
-- 5 a day and 20 a week for the 300, 1 a day and 3 a week for the 500. The
-- affiliate table had no `daily_cap` at all and `play_affiliate_game` did not
-- look at caps, so copying the weights alone would have copied the shape of
-- the ads economy without the brake on it. Both are added here.
--
-- The caps are PLATFORM-WIDE, not per player, exactly as `game_eligible_prizes`
-- counts them: once the jackpot has gone three times this week it is out of
-- the draw for everybody.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The missing column, and a shape that matches the ads table
-- ---------------------------------------------------------------------------

alter table public.affiliate_game_prizes
  add column if not exists daily_cap int not null default 0;

/* `weekly_cap` was nullable here and 0-means-none there. One meaning, so the
   two tables can be reasoned about together. */
update public.affiliate_game_prizes set weekly_cap = 0 where weekly_cap is null;

alter table public.affiliate_game_prizes
  alter column weekly_cap set default 0,
  alter column weekly_cap set not null;

alter table public.affiliate_game_prizes
  drop constraint if exists affiliate_prize_caps_sane;
alter table public.affiliate_game_prizes
  add constraint affiliate_prize_caps_sane check (daily_cap >= 0 and weekly_cap >= 0);

-- ---------------------------------------------------------------------------
-- 2. Which prizes are actually in the draw right now
-- ---------------------------------------------------------------------------

create or replace function public.affiliate_eligible_prizes(
  p_game public.affiliate_game_kind,
  p_week date
)
returns setof public.affiliate_game_prizes
language sql
stable
set search_path = ''
as $$
  select p.*
    from public.affiliate_game_prizes p
   where p.game = p_game
     and p.is_active
     and p.weight > 0
     and (p.daily_cap = 0 or (
       select count(*) from public.affiliate_game_plays g
        where g.prize_id = p.id and g.created_at >= date_trunc('day', now())
     ) < p.daily_cap)
     and (p.weekly_cap = 0 or (
       select count(*) from public.affiliate_game_plays g
        where g.prize_id = p.id and g.week_start = p_week
     ) < p.weekly_cap)
   order by p.slot
$$;

revoke execute on function public.affiliate_eligible_prizes(public.affiliate_game_kind, date)
  from public, anon, authenticated;
grant execute on function public.affiliate_eligible_prizes(public.affiliate_game_kind, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. The draw respects the caps
-- ---------------------------------------------------------------------------

create or replace function public.play_affiliate_game(
  p_user_id uuid,
  p_game    public.affiliate_game_kind
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_aff    uuid;
  v_week   date := public.affiliate_week_start();
  v_total  int;
  v_bytes  bytea;
  v_draw   numeric;
  v_roll   numeric;
  v_prize  public.affiliate_game_prizes;
  v_acc    numeric := 0;
begin
  if not coalesce(public.config_bool('affiliate_games_enabled'), false) then
    raise exception 'The games are not open yet' using errcode = 'check_violation';
  end if;

  select id into v_aff from public.affiliate_accounts where user_id = p_user_id;
  if v_aff is null then
    raise exception 'You are not an affiliate' using errcode = 'check_violation';
  end if;

  v_status := public.affiliate_game_status(p_user_id);
  if (v_status->>'left')::int <= 0 then
    raise exception 'No plays left this week' using errcode = 'check_violation';
  end if;

  /* ⚠️ ELIGIBLE, not merely active. A prize that has hit its daily or weekly
     ceiling is out of the draw and out of the total, so the remaining odds
     re-normalise over what is left rather than the jackpot silently becoming
     a re-roll. */
  select coalesce(sum(weight), 0) into v_total
    from public.affiliate_eligible_prizes(p_game, v_week);

  if v_total <= 0 then
    raise exception 'This game has no prizes set up' using errcode = 'check_violation';
  end if;

  /* `gen_random_bytes`, not `random()`: Postgres's PRNG is seeded and
     deterministic, and this decides money. Every term is numeric BEFORE it is
     added, because four bytes assembled as integers overflow int. */
  v_bytes := extensions.gen_random_bytes(4);
  v_draw  := get_byte(v_bytes, 0)::numeric * 16777216
           + get_byte(v_bytes, 1)::numeric * 65536
           + get_byte(v_bytes, 2)::numeric * 256
           + get_byte(v_bytes, 3)::numeric;
  v_roll  := v_draw / 4294967296::numeric * v_total;

  for v_prize in select * from public.affiliate_eligible_prizes(p_game, v_week) loop
    v_acc := v_acc + v_prize.weight;
    exit when v_roll < v_acc;
  end loop;

  insert into public.affiliate_game_plays
    (user_id, affiliate_id, game, prize_id, slot, amount_minor, extra_plays_awarded,
     roll, weight_total, week_start)
  values
    (p_user_id, v_aff, p_game, v_prize.id, v_prize.slot, v_prize.amount_minor,
     v_prize.extra_plays, v_roll, v_total, v_week);

  if v_prize.amount_minor > 0 then
    insert into public.commission_ledger
      (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
    values
      (v_aff, 'adjustment', v_prize.amount_minor, 'cleared',
       'Game prize: ' || v_prize.label,
       'affiliate-game-' || gen_random_uuid()::text);
  end if;

  return jsonb_build_object(
    'slot',         v_prize.slot,
    'label',        v_prize.label,
    'amount_minor', v_prize.amount_minor,
    'extra_plays',  v_prize.extra_plays,
    'status',       public.affiliate_game_status(p_user_id)
  );
end;
$$;

revoke execute on function public.play_affiliate_game(uuid, public.affiliate_game_kind)
  from public, anon, authenticated;
grant execute on function public.play_affiliate_game(uuid, public.affiliate_game_kind)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Twelve prizes a game, converted 1:1 from the ads tables
-- ---------------------------------------------------------------------------

/* Upserted rather than replaced: `affiliate_game_plays.prize_id` points at
   these rows, and prizes have already been won. Deleting them would take the
   record of what somebody won with them. */
insert into public.affiliate_game_prizes
  (game, slot, label, amount_minor, extra_plays, weight, colour, daily_cap, weekly_cap, is_active)
values
  ('spin_wheel',  1, 'GHS 0.10',  10, 0, 2200, '#f43f5e', 0,  0, true),
  ('spin_wheel',  2, 'GHS 0.20',  20, 0, 2000, '#fb923c', 0,  0, true),
  ('spin_wheel',  3, 'GHS 0.30',  30, 0, 1500, '#fbbf24', 0,  0, true),
  ('spin_wheel',  4, 'GHS 0.40',  40, 0, 1200, '#a3e635', 0,  0, true),
  ('spin_wheel',  5, 'GHS 0.50',  50, 0,  900, '#34d399', 0,  0, true),
  ('spin_wheel',  6, 'GHS 1',    100, 0,  700, '#22d3ee', 0,  0, true),
  ('spin_wheel',  7, 'GHS 1.50', 150, 0,  550, '#38bdf8', 0,  0, true),
  ('spin_wheel',  8, 'GHS 2',    200, 0,  350, '#818cf8', 0,  0, true),
  ('spin_wheel',  9, 'GHS 2.50', 250, 0,  150, '#c084fc', 0,  0, true),
  ('spin_wheel', 10, 'Try Again',  0, 1,  400, '#f472b6', 0,  0, true),
  ('spin_wheel', 11, 'GHS 3',    300, 0,   40, '#e879f9', 5, 20, true),
  ('spin_wheel', 12, 'GHS 5',    500, 0,   10, '#facc15', 1,  3, true),

  ('mystery_box',  1, 'GHS 0.10',  10, 0, 2200, '#38bdf8', 0,  0, true),
  ('mystery_box',  2, 'GHS 0.20',  20, 0, 2000, '#34d399', 0,  0, true),
  ('mystery_box',  3, 'GHS 0.30',  30, 0, 1500, '#a78bfa', 0,  0, true),
  ('mystery_box',  4, 'GHS 0.40',  40, 0, 1200, '#f472b6', 0,  0, true),
  ('mystery_box',  5, 'GHS 0.50',  50, 0,  900, '#fbbf24', 0,  0, true),
  ('mystery_box',  6, 'GHS 1',    100, 0,  700, '#22d3ee', 0,  0, true),
  ('mystery_box',  7, 'GHS 1.50', 150, 0,  450, '#fb923c', 0,  0, true),
  ('mystery_box',  8, 'GHS 2',    200, 0,  250, '#4ade80', 0,  0, true),
  ('mystery_box',  9, 'GHS 2.50', 250, 0,  150, '#c084fc', 0,  0, true),
  ('mystery_box', 10, 'Try Again',  0, 1,  400, '#60a5fa', 0,  0, true),
  ('mystery_box', 11, 'GHS 3',    300, 0,   40, '#f43f5e', 5, 20, true),
  ('mystery_box', 12, 'GHS 5',    500, 0,   10, '#eab308', 1,  3, true)
on conflict (game, slot) do update
  set label        = excluded.label,
      amount_minor = excluded.amount_minor,
      extra_plays  = excluded.extra_plays,
      weight       = excluded.weight,
      colour       = excluded.colour,
      daily_cap    = excluded.daily_cap,
      weekly_cap   = excluded.weekly_cap,
      is_active    = excluded.is_active,
      updated_at   = now();
