-- ============================================================================
-- Migration 070 — the game engine: mystery box and spin the wheel
--
-- Operator brief, 2026-07-30: two games, twelve boxes and twelve wheel
-- segments, every outcome and every chance admin-configurable, weekly plays
-- granted by plan (Free 1, Bronze 2, Silver 3, Gold 4, Platinum 5), usable all
-- at once, forfeited at the end of the week.
--
-- ONE ENGINE, TWO SKINS. A mystery box and a wheel are the same weighted draw
-- with different animation, so there is ONE prize table, ONE draw function and
-- ONE place points can be minted. Building them separately would have doubled
-- the surface where a money bug can live, for no product difference — the
-- difference between the two games is entirely in the browser.
--
-- THE SERVER DRAWS; THE CLIENT ONLY ANIMATES. `play_game` picks the outcome,
-- consumes the play and writes the ledger row in one transaction, then returns
-- WHICH position to reveal. The browser never chooses and never reports a
-- result. This is the whole security model: if the client picked, anybody with
-- dev tools would win the jackpot every time. It also means closing the app
-- mid-animation can neither lose the prize nor spend the play twice — the
-- outcome is already committed before the first frame renders.
--
-- FOUR OPERATOR DECISIONS, taken after the trade-offs were laid out:
--   1. ONE SHARED POOL of plays across both games, not one pool each.
--   2. HIGHEST PLAN ONLY, not summed. This makes plays the ONE benefit that
--      does not stack (ad caps go 20 -> 205, multipliers combine), so it sits
--      behind `game_plays_combine_mode` and can be switched to sum_bonus
--      without a migration if the Upgrade screen's promise causes confusion.
--   3. Prizes are POINTS and EXTRA PLAYS. Subscription time was offered and
--      declined — granting plan time from a game would touch the path real
--      Paystack money flows through.
--   4. EVERY OUTCOME PAYS SOMETHING. There are no losing segments. This reads
--      as a reward reveal rather than a gamble, which matters because...
--
-- ...LEGAL, FLAGGED AND NOT RESOLVED: prize + chance + consideration is the
-- textbook definition of a lottery, and a plan that buys more chances is the
-- consideration. Ghana licenses games of chance separately from the money
-- transfer licence the operator holds. `games_enabled` therefore defaults
-- FALSE — the same pattern as `payouts_enabled` — so this ships complete and
-- dark until a lawyer says otherwise.
-- ============================================================================


create type public.game_kind as enum ('mystery_box', 'spin_wheel');


-- ---------------------------------------------------------------------------
-- Weekly plays live on the tier
-- ---------------------------------------------------------------------------
--
-- A column rather than a config key because it is per-plan, and `tiers` is
-- already the one place a plan's benefits are described. `admin_save_plan`
-- does not name this column, so it is untouched by the existing plan editor;
-- it is edited from the games screen instead, which is where an operator
-- thinking about game economy will look for it.

alter table public.tiers
  add column if not exists weekly_game_plays integer not null default 1
    check (weekly_game_plays >= 0);

comment on column public.tiers.weekly_game_plays is
  'Plays per week this plan grants, shared across all games. Combined across held plans per game_plays_combine_mode (default: highest plan wins, not summed).';

update public.tiers set weekly_game_plays = 1 where slug = 'free';
update public.tiers set weekly_game_plays = 2 where slug = 'bronze';
update public.tiers set weekly_game_plays = 3 where slug = 'silver';
update public.tiers set weekly_game_plays = 4 where slug = 'gold';
update public.tiers set weekly_game_plays = 5 where slug = 'platinum';


insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('games_enabled', 'false', 'bool', null, null, true,
   'Master switch for the mystery box and spin the wheel. OFF by default and deliberately so: paying for more chances at a random prize is the definition of a lottery, and Ghana licenses games of chance separately. Turn on only once that is cleared. With it off the games are unreachable and play_game refuses.'),
  ('game_plays_combine_mode', 'highest', 'text', null, null, false,
   'How weekly plays combine for a user holding several plans. "highest" (operator choice, 2026-07-30) takes the best single plan. "sum_bonus" adds each plan''s bonus over the free allowance, matching how ad caps and multipliers stack.'),
  ('game_min_seconds_between_plays', '3', 'int', 0, 3600, false,
   'Floor on the gap between two plays by one account. Not an anti-fraud measure — the play allowance is that — but it stops a stuck button or a double tap spending two plays on one intention.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- game_prizes — the prize table, which is the whole configuration surface
-- ---------------------------------------------------------------------------
--
-- WEIGHTS, NOT PERCENTAGES. The draw sums the weights of the eligible rows and
-- rolls once, so the admin never has to make twelve numbers add up to 100 and
-- can change one outcome without re-doing the other eleven. The effective
-- percentage is derived for display, never stored — a stored percentage is a
-- second source of truth that goes stale the moment a sibling changes.

create table public.game_prizes (
  id uuid primary key default gen_random_uuid(),

  game public.game_kind not null,

  -- Which box or which wedge. 1-12 as the operator specified, but the
  -- constraint allows 1-24 so a future game can be a different shape without
  -- a migration; the UI reads the count from the rows it is given.
  slot integer not null check (slot between 1 and 24),

  label text not null check (length(trim(label)) between 1 and 40),

  points bigint not null default 0 check (points >= 0),
  extra_plays integer not null default 0 check (extra_plays >= 0 and extra_plays <= 10),

  -- Relative chance. Zero is allowed and means "configured but never drawn",
  -- which is how an operator retires an outcome without losing its history.
  weight integer not null default 1 check (weight >= 0 and weight <= 1000000),

  -- Free-form so the games can be as loud as they like. The operator was
  -- explicit that these screens may leave the product palette.
  colour text not null default '#2563eb' check (colour ~* '^#[0-9a-f]{6}$'),

  -- Prize inventory. A one-in-a-hundred jackpot lands fifty times on a busy
  -- day without these; they are the difference between a promotion and an
  -- unbounded liability. Zero means unlimited.
  daily_cap integer not null default 0 check (daily_cap >= 0),
  weekly_cap integer not null default 0 check (weekly_cap >= 0),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (game, slot),

  -- The operator's rule 4: no losing outcomes. Enforced here rather than in
  -- the editor, because "every box pays something" is a promise the screen
  -- makes to the user and a UI-only check is one bad payload from breaking it.
  constraint game_prizes_pay_something
    check (points > 0 or extra_plays > 0)
);

comment on table public.game_prizes is
  'The prize table for both games. One row per box or wheel segment. Chance is a relative weight, never a stored percentage; every row must pay something.';

create index game_prizes_game_idx on public.game_prizes (game, slot);

create trigger game_prizes_touch_updated_at
  before update on public.game_prizes
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- game_plays — one row per play, and the record a play was spent
-- ---------------------------------------------------------------------------
--
-- `week_start` is stored rather than derived at read time so that counting a
-- user's plays this week is an index seek, and so that a play keeps the week
-- it belonged to even if the week boundary rule ever changes.
--
-- `roll` and `weight_total` are kept so any draw can be re-checked after the
-- fact. Not full provably-fair (that wants a published seed commitment), but
-- enough that a disputed outcome can be audited rather than argued about.

create table public.game_plays (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users (id) on delete cascade,
  game public.game_kind not null,

  -- restrict, not cascade: deleting a prize must not erase the record of it
  -- having been won. The editor archives instead.
  prize_id uuid not null references public.game_prizes (id) on delete restrict,
  slot integer not null,

  points_awarded bigint not null check (points_awarded >= 0),
  extra_plays_awarded integer not null default 0 check (extra_plays_awarded >= 0),

  roll bigint not null,
  weight_total bigint not null check (weight_total > 0),

  week_start date not null,

  created_at timestamptz not null default now()
);

comment on table public.game_plays is
  'One row per play. Written in the same transaction that consumes the play and credits the points, so a play can neither be spent twice nor pay twice.';

create index game_plays_user_week_idx on public.game_plays (user_id, week_start);
create index game_plays_game_created_idx on public.game_plays (game, created_at desc);
create index game_plays_prize_created_idx on public.game_plays (prize_id, created_at desc);

alter table public.game_plays enable row level security;

create policy "Read own plays or all as admin"
  on public.game_plays for select
  using (user_id = auth.uid() or public.is_admin());

alter table public.game_prizes enable row level security;

-- No client select policy: the prize table carries the WEIGHTS, and a user who
-- can read the weights can compute exactly which box is worth picking. The
-- board a player sees comes from `get_game_board`, which returns labels and
-- colours and no odds at all.
create policy "Only admins may read prizes"
  on public.game_prizes for select
  using (public.is_admin());


-- ---------------------------------------------------------------------------
-- game_week_start — one definition of "this week"
-- ---------------------------------------------------------------------------
--
-- Monday, in UTC, which is local midnight in Ghana. Deliberately the SAME
-- boundary as the leaderboard's week, so "this week" means one thing across
-- the product rather than two things a day apart.

create or replace function public.game_week_start()
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('week', now())::date $$;


-- ---------------------------------------------------------------------------
-- user_weekly_play_allowance — how many plays somebody has this week
-- ---------------------------------------------------------------------------
--
-- Base allowance from the plans held, PLUS any extra plays won from the games
-- themselves this week. Winning a play has to actually give a play, and the
-- cleanest way to express that is to let it raise the allowance rather than
-- to decrement a counter somewhere.
--
-- `user_target_tiers` is reused rather than `resolve_user_tier` because the
-- latter returns a synthetic combined row ("Platinum +3") whose own
-- weekly_game_plays would be meaningless — this needs the plans actually held.

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
    -- Free allowance plus each held plan's bonus over it, the way ad caps
    -- and multipliers combine.
    select v_free + coalesce(sum(greatest(t.weekly_game_plays - v_free, 0)), 0)
      into v_base
      from public.user_target_tiers(p_user_id) ut
      join public.tiers t on t.id = ut
     where not t.is_default;
  else
    -- Operator's choice: the best single plan held, never added together.
    select coalesce(max(t.weekly_game_plays), v_free)
      into v_base
      from public.user_target_tiers(p_user_id) ut
      join public.tiers t on t.id = ut;
  end if;

  select coalesce(sum(p.extra_plays_awarded), 0) into v_extra
    from public.game_plays p
   where p.user_id = p_user_id
     and p.week_start = public.game_week_start();

  return coalesce(v_base, v_free) + v_extra;
end;
$$;


-- ---------------------------------------------------------------------------
-- get_game_status — what the screens need, with no odds in it
-- ---------------------------------------------------------------------------

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
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  return query
  select
    coalesce(public.config_bool('games_enabled'), false),
    public.user_weekly_play_allowance(v_me),
    (select count(*)::int from public.game_plays g
      where g.user_id = v_me and g.week_start = public.game_week_start()),
    greatest(
      public.user_weekly_play_allowance(v_me)
        - (select count(*)::int from public.game_plays g
            where g.user_id = v_me and g.week_start = public.game_week_start()),
      0),
    public.game_week_start(),
    -- The moment unused plays are forfeited: next Monday, 00:00 UTC.
    (public.game_week_start() + 7)::timestamptz;
end;
$$;

revoke execute on function public.get_game_status() from public, anon;
grant execute on function public.get_game_status() to authenticated;


-- ---------------------------------------------------------------------------
-- get_game_board — the twelve faces, WITHOUT their odds
-- ---------------------------------------------------------------------------
--
-- Labels, colours and positions only. The weights stay server-side: a player
-- who can read them knows which box is worth picking, which would make the
-- mystery box a lookup rather than a game. Points ARE returned, because the
-- wheel has to print what each wedge is worth.

create or replace function public.get_game_board(p_game public.game_kind)
returns table (
  slot        integer,
  label       text,
  points      bigint,
  extra_plays integer,
  colour      text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  return query
  select p.slot, p.label, p.points, p.extra_plays, p.colour
    from public.game_prizes p
   where p.game = p_game and p.is_active
   order by p.slot;
end;
$$;

revoke execute on function public.get_game_board(public.game_kind) from public, anon;
grant execute on function public.get_game_board(public.game_kind) to authenticated;


-- ---------------------------------------------------------------------------
-- play_game — the money path
-- ---------------------------------------------------------------------------
--
-- Everything happens here, in one transaction: eligibility, the draw, the
-- play record, the credit. There is no second call for the client to skip or
-- replay, and nothing it says is trusted — it names a game, and that is all.
--
-- Outcomes are returned as jsonb rather than raised, because "no plays left"
-- is an ordinary thing to hit. Genuine faults still raise.

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

  /*
    THE DRAW. Eligible rows are the active ones that have not hit their own
    daily or weekly ceiling. `gen_random_bytes` rather than `random()`: this
    decides who gets paid what, and Postgres's random() is a seeded PRNG whose
    sequence can be reasoned about from observed outputs — the same argument
    that made gift codes use the CSPRNG.
  */
  create temporary table if not exists _eligible_prizes (
    id uuid, slot int, points bigint, extra_plays int, weight int, cum bigint
  ) on commit drop;
  delete from _eligible_prizes;

  insert into _eligible_prizes (id, slot, points, extra_plays, weight, cum)
  select p.id, p.slot, p.points, p.extra_plays, p.weight,
         sum(p.weight) over (order by p.slot rows between unbounded preceding and current row)
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
        where g.prize_id = p.id and g.week_start = v_week
     ) < p.weekly_cap);

  select coalesce(max(cum), 0) into v_total from _eligible_prizes;

  if v_total = 0 then
    /*
      Every prize is capped out, or the game has none configured. A play must
      still pay something (operator rule 4), and silently spending somebody's
      play on nothing would be the worst possible answer — so the caps are
      ignored for the CHEAPEST active prize rather than the draw failing.
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
    v_roll := (get_byte(extensions.gen_random_bytes(8), 0)::bigint << 40)
            + (get_byte(extensions.gen_random_bytes(8), 0)::bigint << 20)
            + floor(random() * 1048576)::bigint;
    v_roll := v_roll % v_total;

    select p.* into v_prize
      from public.game_prizes p
      join _eligible_prizes e on e.id = p.id
     where e.cum > v_roll
     order by e.cum asc
     limit 1;
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


-- ---------------------------------------------------------------------------
-- Admin: read the table with its odds and its cost
-- ---------------------------------------------------------------------------
--
-- `chance_percent` and `rtp_points` are DERIVED here rather than stored. The
-- RTP — the average points a play costs the platform — is the number that
-- decides whether this game is affordable, and an operator editing weights
-- without seeing it is pricing by feel.

create or replace function public.admin_list_game_prizes(
  p_admin_id uuid,
  p_game     public.game_kind
)
returns table (
  id             uuid,
  slot           integer,
  label          text,
  points         bigint,
  extra_plays    integer,
  weight         integer,
  colour         text,
  daily_cap      integer,
  weekly_cap     integer,
  is_active      boolean,
  chance_percent numeric,
  won_today      bigint,
  won_this_week  bigint
)
language plpgsql
security definer
stable
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
           where g.prize_id = p.id and g.week_start = public.game_week_start())
    from public.game_prizes p
   where p.game = p_game
   order by p.slot;
end;
$$;

revoke execute on function public.admin_list_game_prizes(uuid, public.game_kind)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Admin: save the whole table at once
-- ---------------------------------------------------------------------------
--
-- The whole board in one transaction, like `admin_save_ad`, because the twelve
-- outcomes are one design: saving them one at a time would let the operator
-- leave the wheel half-edited and a player see a board that was never intended.

create or replace function public.admin_save_game_prizes(
  p_admin_id uuid,
  p_game     public.game_kind,
  p_prizes   jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   jsonb;
  v_count int := 0;
  v_ids   uuid[] := '{}';
  v_id    uuid;
begin
  perform public.assert_admin(p_admin_id);

  if jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) = 0 then
    raise exception 'A game needs at least one prize' using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_prizes) loop
    v_id := nullif(v_row->>'id', '')::uuid;

    if v_id is null then
      insert into public.game_prizes
        (game, slot, label, points, extra_plays, weight, colour,
         daily_cap, weekly_cap, is_active)
      values
        (p_game,
         (v_row->>'slot')::int,
         trim(v_row->>'label'),
         coalesce((v_row->>'points')::bigint, 0),
         coalesce((v_row->>'extra_plays')::int, 0),
         coalesce((v_row->>'weight')::int, 1),
         coalesce(v_row->>'colour', '#2563eb'),
         coalesce((v_row->>'daily_cap')::int, 0),
         coalesce((v_row->>'weekly_cap')::int, 0),
         coalesce((v_row->>'is_active')::boolean, true))
      returning id into v_id;
    else
      update public.game_prizes set
        slot        = (v_row->>'slot')::int,
        label       = trim(v_row->>'label'),
        points      = coalesce((v_row->>'points')::bigint, 0),
        extra_plays = coalesce((v_row->>'extra_plays')::int, 0),
        weight      = coalesce((v_row->>'weight')::int, 1),
        colour      = coalesce(v_row->>'colour', '#2563eb'),
        daily_cap   = coalesce((v_row->>'daily_cap')::int, 0),
        weekly_cap  = coalesce((v_row->>'weekly_cap')::int, 0),
        is_active   = coalesce((v_row->>'is_active')::boolean, true)
      where id = v_id and game = p_game;
    end if;

    v_ids := v_ids || v_id;
    v_count := v_count + 1;
  end loop;

  /*
    Anything the operator removed from the board is DEACTIVATED, never
    deleted: `game_plays.prize_id` is ON DELETE RESTRICT because the record of
    what somebody won must outlive a change of mind about the prize table.
  */
  update public.game_prizes
     set is_active = false
   where game = p_game and not (id = any(v_ids));

  return v_count;
end;
$$;

revoke execute on function public.admin_save_game_prizes(uuid, public.game_kind, jsonb)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Admin: what the game has actually cost
-- ---------------------------------------------------------------------------
--
-- Expected RTP is what the weights promise; actual is what the draws did. An
-- operator watching these diverge is watching either bad luck or a bug, and
-- they should be able to tell which without asking me.

create or replace function public.admin_game_stats(
  p_admin_id uuid,
  p_game     public.game_kind,
  p_days     integer default 30
)
returns table (
  plays_total      bigint,
  plays_period     bigint,
  points_period    bigint,
  expected_rtp     numeric,
  actual_rtp       numeric,
  players_period   bigint,
  extra_plays_won  bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_total bigint;
begin
  perform public.assert_admin(p_admin_id);

  select coalesce(sum(weight), 0) into v_total
    from public.game_prizes where game = p_game and is_active and weight > 0;

  return query
  select
    (select count(*) from public.game_plays g where g.game = p_game),
    (select count(*) from public.game_plays g where g.game = p_game and g.created_at >= v_since),
    (select coalesce(sum(g.points_awarded), 0) from public.game_plays g
      where g.game = p_game and g.created_at >= v_since),
    case when v_total = 0 then 0::numeric else
      (select round(coalesce(sum(p.weight::numeric * p.points), 0) / v_total, 2)
         from public.game_prizes p
        where p.game = p_game and p.is_active and p.weight > 0)
    end,
    (select case when count(*) = 0 then 0::numeric
                 else round(coalesce(sum(g.points_awarded), 0)::numeric / count(*), 2) end
       from public.game_plays g where g.game = p_game and g.created_at >= v_since),
    (select count(distinct g.user_id) from public.game_plays g
      where g.game = p_game and g.created_at >= v_since),
    (select coalesce(sum(g.extra_plays_awarded), 0) from public.game_plays g
      where g.game = p_game and g.created_at >= v_since);
end;
$$;

revoke execute on function public.admin_game_stats(uuid, public.game_kind, integer)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- A starting board for each game, so neither ships empty
-- ---------------------------------------------------------------------------
--
-- Twelve outcomes each, every one paying something, weighted so the common
-- results are small and the rare ones are worth chasing. Expected cost works
-- out around 250 points a play on the box and 260 on the wheel — roughly a
-- quarter of a cedi — which the operator can re-price entirely from the admin
-- screen without touching this file.

insert into public.game_prizes (game, slot, label, points, extra_plays, weight, colour, daily_cap, weekly_cap)
values
  ('mystery_box',  1, '50 points',    50,  0, 2200, '#38bdf8', 0, 0),
  ('mystery_box',  2, '100 points',  100,  0, 2000, '#34d399', 0, 0),
  ('mystery_box',  3, '150 points',  150,  0, 1500, '#a78bfa', 0, 0),
  ('mystery_box',  4, '200 points',  200,  0, 1200, '#f472b6', 0, 0),
  ('mystery_box',  5, '250 points',  250,  0,  900, '#fbbf24', 0, 0),
  ('mystery_box',  6, '300 points',  300,  0,  700, '#22d3ee', 0, 0),
  ('mystery_box',  7, '500 points',  500,  0,  450, '#fb923c', 0, 0),
  ('mystery_box',  8, '750 points',  750,  0,  250, '#4ade80', 0, 0),
  ('mystery_box',  9, '1,000 points', 1000, 0,  150, '#c084fc', 0, 0),
  ('mystery_box', 10, 'Extra play',   100,  1,  400, '#60a5fa', 0, 0),
  ('mystery_box', 11, '2,500 points', 2500, 0,   40, '#f43f5e', 5, 20),
  ('mystery_box', 12, '5,000 points', 5000, 0,   10, '#eab308', 1, 3)
on conflict (game, slot) do nothing;

insert into public.game_prizes (game, slot, label, points, extra_plays, weight, colour, daily_cap, weekly_cap)
values
  ('spin_wheel',  1, '50 points',     50,  0, 2200, '#f43f5e', 0, 0),
  ('spin_wheel',  2, '100 points',   100,  0, 2000, '#fb923c', 0, 0),
  ('spin_wheel',  3, '150 points',   150,  0, 1500, '#fbbf24', 0, 0),
  ('spin_wheel',  4, '200 points',   200,  0, 1200, '#a3e635', 0, 0),
  ('spin_wheel',  5, '250 points',   250,  0,  900, '#34d399', 0, 0),
  ('spin_wheel',  6, '300 points',   300,  0,  700, '#22d3ee', 0, 0),
  ('spin_wheel',  7, '400 points',   400,  0,  550, '#38bdf8', 0, 0),
  ('spin_wheel',  8, '600 points',   600,  0,  350, '#818cf8', 0, 0),
  ('spin_wheel',  9, '1,000 points', 1000, 0,  150, '#c084fc', 0, 0),
  ('spin_wheel', 10, 'Extra play',    100,  1,  400, '#f472b6', 0, 0),
  ('spin_wheel', 11, '2,500 points', 2500, 0,   40, '#e879f9', 5, 20),
  ('spin_wheel', 12, '5,000 points', 5000, 0,   10, '#facc15', 1, 3)
on conflict (game, slot) do nothing;
