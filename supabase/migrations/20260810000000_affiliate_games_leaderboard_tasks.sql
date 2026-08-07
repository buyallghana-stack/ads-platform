-- ---------------------------------------------------------------------------
-- Games, a leaderboard and tasks for the AFFILIATE business (operator,
-- 2026-08-07), all three denominated in cedis rather than points.
--
-- ⚠️ NOTHING HERE SHARES A TABLE OR A FUNCTION WITH PHASE 1. `game_plays`,
-- `tasks`, `get_leaderboard` and friends stay exactly as they are. D27 is that
-- points and commission never mix, and the way that stays structural rather
-- than remembered is that there is no row anywhere carrying both. The cost is
-- two similar systems; the alternative is one system with a `mode` column and
-- a branch at every step, where the first branch anybody forgets pays the
-- wrong balance.
--
-- ── WHAT A PRIZE AND A REWARD ACTUALLY PAY ──
--
-- A `commission_ledger` row of type `adjustment`, cleared immediately, so it
-- lands in the same balance the affiliate withdraws from and needs no second
-- reconciliation. `credit` is not usable: `commission_credit_shape` requires a
-- conversion and a level, because a credit means a sale. A game prize is not
-- a sale.
--
-- ── REWARDED ONCE, AND ONLY ONCE ──
--
-- `affiliate_task_completions` is unique on (task_id, user_id). The operator's
-- rule: "a user may be overtaken but bounce back, no one should be rewarded
-- for an action that is already completed." So a ranking task pays the first
-- time the rank is reached and never again, and losing the rank afterwards
-- takes nothing back. The guarantee is the constraint, not a status column.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('affiliate_games_enabled', 'false', 'bool', null, null, false,
   'Whether affiliates can play the reward games. Ships off, like the points games did, so prizes can be tuned before anything is won.'),
  ('affiliate_weekly_plays_beginner', '1', 'int', 0, 50, false,
   'Plays a week for an affiliate on the Beginner training programme.'),
  ('affiliate_weekly_plays_professional', '3', 'int', 0, 50, false,
   'Plays a week for an affiliate on the Professional training programme.'),
  ('affiliate_leaderboard_visible_ranks', '100', 'int', 3, 500, false,
   'How many places the affiliate leaderboard shows.'),
  ('affiliate_leaderboard_shows_zero_earners', 'false', 'bool', null, null, false,
   'Whether affiliates who have earned nothing in the period appear on the board.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.affiliate_game_kind as enum ('mystery_box', 'spin_wheel');
exception when duplicate_object then null; end $$;

do $$ begin
  /* The four things an affiliate does that are worth setting a goal against.
     `leaderboard_rank` is the odd one: lower is better, and it is measured
     against a position rather than counted up to a total. */
  create type public.affiliate_task_metric as enum
    ('sales', 'referrals', 'games_played', 'leaderboard_rank');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Games
-- ---------------------------------------------------------------------------

create table if not exists public.affiliate_game_prizes (
  id           uuid primary key default gen_random_uuid(),
  game         public.affiliate_game_kind not null,
  slot         int not null,
  label        text not null,
  /* In pesewas, like every other money column in this schema. */
  amount_minor bigint not null default 0,
  extra_plays  int not null default 0,
  weight       int not null default 1,
  colour       text,
  weekly_cap   int,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint affiliate_prize_slot_unique unique (game, slot),
  constraint affiliate_prize_weight_sane check (weight > 0),
  constraint affiliate_prize_amount_sane check (amount_minor >= 0),
  constraint affiliate_prize_plays_sane  check (extra_plays >= 0)
);

create table if not exists public.affiliate_game_plays (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  affiliate_id   uuid not null references public.affiliate_accounts(id) on delete cascade,
  game           public.affiliate_game_kind not null,
  prize_id       uuid references public.affiliate_game_prizes(id),
  slot           int,
  amount_minor   bigint not null default 0,
  extra_plays_awarded int not null default 0,
  /* Kept for the same reason the points game keeps them: a prize nobody can
     recompute is a prize nobody can audit. */
  roll           numeric(12,6),
  weight_total   int,
  week_start     date not null,
  created_at     timestamptz not null default now()
);

create index if not exists affiliate_game_plays_user_week_idx
  on public.affiliate_game_plays (user_id, week_start);

alter table public.affiliate_game_prizes enable row level security;
alter table public.affiliate_game_plays  enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Tasks
-- ---------------------------------------------------------------------------

create table if not exists public.affiliate_tasks (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  description  text,
  metric       public.affiliate_task_metric not null,
  /* For a counting metric this is how many. For `leaderboard_rank` it is the
     place to reach: target 10 means "finish in the top 10". */
  target       int not null,
  reward_minor bigint not null default 0,
  icon         text,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint affiliate_task_target_sane check (target > 0),
  constraint affiliate_task_reward_sane check (reward_minor >= 0)
);

create table if not exists public.affiliate_task_completions (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.affiliate_tasks(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  progress_at_claim bigint not null,
  reward_minor     bigint not null,
  claimed_at       timestamptz not null default now(),

  /* THE WHOLE RULE, AS A CONSTRAINT. A second claim is unrepresentable rather
     than merely refused. */
  constraint affiliate_task_once unique (task_id, user_id)
);

alter table public.affiliate_tasks             enable row level security;
alter table public.affiliate_task_completions  enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Reads
-- ---------------------------------------------------------------------------

create or replace function public.affiliate_week_start()
returns date language sql stable set search_path = '' as $$
  select (date_trunc('week', now() at time zone 'UTC'))::date;
$$;

/**
 * Plays a week, from the training programme rather than from an ads plan.
 *
 * Professional 3, Beginner 1, both configurable. An affiliate whose
 * entitlement has lapsed gets nothing: the plays are a benefit of the
 * programme, and the programme has ended.
 */
create or replace function public.affiliate_weekly_play_allowance(p_user_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier text;
begin
  /* ⚠️ THE TIER IS NOT ON THE ENTITLEMENT. `affiliate_entitlements` carries an
     `affiliate_id` and a `training_program_id`; the level lives on
     `training_programs.level`, which is what `affiliate_dashboard` reads too.
     Holding both programmes takes the higher one. */
  select tp.level::text
    into v_tier
    from public.affiliate_entitlements e
    join public.affiliate_accounts a on a.id = e.affiliate_id
    join public.training_programs tp on tp.id = e.training_program_id
   where a.user_id = p_user_id
     and e.status = 'active'
     and (e.expires_at is null or e.expires_at > now())
   order by case when tp.level::text = 'professional' then 0 else 1 end
   limit 1;

  if v_tier is null then return 0; end if;

  return case v_tier
    when 'professional' then coalesce(public.config_int('affiliate_weekly_plays_professional'), 3)
    else coalesce(public.config_int('affiliate_weekly_plays_beginner'), 1)
  end;
end;
$$;

create or replace function public.affiliate_game_status(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allowance int := public.affiliate_weekly_play_allowance(p_user_id);
  v_extra     int;
  v_used      int;
  v_week      date := public.affiliate_week_start();
begin
  select coalesce(sum(p.extra_plays_awarded), 0), count(*)
    into v_extra, v_used
    from public.affiliate_game_plays p
   where p.user_id = p_user_id and p.week_start = v_week;

  return jsonb_build_object(
    'enabled',   coalesce(public.config_bool('affiliate_games_enabled'), false),
    'allowance', v_allowance,
    'extra',     v_extra,
    'used',      v_used,
    'left',      greatest(v_allowance + v_extra - v_used, 0),
    'week_start', v_week
  );
end;
$$;

/**
 * The affiliate leaderboard: the same shape as the points board, measuring
 * cleared commission instead.
 *
 * Reversals count, because a clawed-back sale did not happen and a board that
 * ignored them would rank somebody on money they no longer have. Payouts do
 * NOT count: withdrawing is not un-earning, and subtracting it would rank an
 * affiliate below somebody who earned less and left it sitting there.
 */
create or replace function public.affiliate_leaderboard(
  p_period text default 'all',
  p_limit  int default null
)
returns table (
  rank bigint,
  user_id uuid,
  display_name text,
  avatar_path text,
  amount_minor bigint,
  previous_rank bigint,
  movement text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bounds record;
  v_zeros  boolean := coalesce(public.config_bool('affiliate_leaderboard_shows_zero_earners'), false);
  v_limit  int;
begin
  select * into v_bounds from public.leaderboard_period_bounds(p_period);

  v_limit := least(
    coalesce(p_limit, public.config_int('affiliate_leaderboard_visible_ranks')::int, 100),
    500
  );

  return query
  with live as (
    select a.id as affiliate_id, a.user_id, p.full_name, p.avatar_path
      from public.affiliate_accounts a
      join public.profiles p on p.id = a.user_id
     where p.deleted_at is null
       and p.disabled_at is null
       and a.status <> 'suspended'
  ),
  counted as (
    select cl.affiliate_id, cl.amount_minor, cl.created_at
      from public.commission_ledger cl
     where cl.entry_type in ('credit', 'reversal', 'adjustment')
  ),
  cur as (
    select live.user_id,
           live.full_name,
           live.avatar_path,
           coalesce(sum(c.amount_minor), 0)::bigint as earned
      from live
      left join counted c
        on c.affiliate_id = live.affiliate_id
       and c.created_at >= v_bounds.cur_start
     group by live.user_id, live.full_name, live.avatar_path
    having v_zeros or coalesce(sum(c.amount_minor), 0) > 0
  ),
  prev as (
    select live.user_id,
           coalesce(sum(c.amount_minor), 0)::bigint as earned
      from live
      left join counted c
        on c.affiliate_id = live.affiliate_id
       and c.created_at >= v_bounds.prev_start
       and c.created_at <  v_bounds.prev_end
     group by live.user_id
  ),
  /* ⚠️ The previous standing is ranked in its OWN cte, and the column is
     called `pos`. Naming it `rank` and then selecting it reads as the window
     function `rank()` and Postgres refuses with "window function rank requires
     an OVER clause", which is a confusing error for what is only a name
     collision. */
  prev_ranked as (
    select prev.user_id, rank() over (order by prev.earned desc) as pos
      from prev
  ),
  ranked as (
    select cur.user_id,
           cur.full_name,
           cur.avatar_path,
           cur.earned,
           rank() over (order by cur.earned desc) as r,
           pr.pos as pr
      from cur
      left join prev_ranked pr on pr.user_id = cur.user_id
  )
  select ranked.r,
         ranked.user_id,
         public.leaderboard_display_name(ranked.full_name),
         ranked.avatar_path,
         ranked.earned,
         ranked.pr,
         case
           when ranked.pr is null then 'new'
           when ranked.r < ranked.pr then 'up'
           when ranked.r > ranked.pr then 'down'
           else 'same'
         end
    from ranked
   order by ranked.r
   limit v_limit;
end;
$$;

/**
 * Where one affiliate stands, whether or not they are inside the visible ranks.
 *
 * Separate from the board for the same reason Phase 1 keeps them separate: the
 * board is capped and the person looking at it is often below the cap, and a
 * screen that cannot tell somebody their own position is the one thing the
 * feature is for.
 */
create or replace function public.affiliate_leaderboard_standing(
  p_user_id uuid,
  p_period  text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select * into v_row
    from public.affiliate_leaderboard(p_period, 500) b
   where b.user_id = p_user_id;

  if not found then
    return jsonb_build_object('ranked', false);
  end if;

  return jsonb_build_object(
    'ranked', true,
    'rank', v_row.rank,
    'amount_minor', v_row.amount_minor,
    'movement', v_row.movement
  );
end;
$$;

/**
 * Progress against one metric.
 *
 * ⚠️ `leaderboard_rank` returns a PLACE, where smaller is better, and 0 when
 * the affiliate is not on the board at all. Everything else counts upwards.
 * `get_affiliate_tasks` is what turns that into "ready or not"; nothing should
 * compare this number to a target without knowing which metric it came from.
 */
create or replace function public.affiliate_task_progress(
  p_user_id uuid,
  p_metric  public.affiliate_task_metric
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bigint := 0;
  v_aff uuid;
  v_standing jsonb;
begin
  select id into v_aff from public.affiliate_accounts where user_id = p_user_id;
  if v_aff is null then return 0; end if;

  case p_metric
    when 'sales' then
      select count(*) into v
        from public.conversions c
       where c.affiliate_id = v_aff and c.status = 'attributed';

    when 'referrals' then
      select count(*) into v
        from public.affiliate_accounts a
       where a.parent_affiliate_id = v_aff;

    when 'games_played' then
      select count(*) into v
        from public.affiliate_game_plays g
       where g.user_id = p_user_id;

    when 'leaderboard_rank' then
      v_standing := public.affiliate_leaderboard_standing(p_user_id, 'all');
      v := case when (v_standing->>'ranked')::boolean then (v_standing->>'rank')::bigint else 0 end;
  end case;

  return coalesce(v, 0);
end;
$$;

create or replace function public.get_affiliate_tasks(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'sort_order', x->>'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',           t.id,
               'code',         t.code,
               'name',         t.name,
               'description',  t.description,
               'metric',       t.metric::text,
               'target',       t.target,
               'reward_minor', t.reward_minor,
               'icon',         t.icon,
               'sort_order',   t.sort_order,
               'progress',     public.affiliate_task_progress(p_user_id, t.metric),
               'claimed',      c.id is not null,
               'claimed_at',   c.claimed_at,
               /* One place decides "can this be claimed", and it is here.
                  A rank is reached by going DOWN to the target; everything
                  else is reached by going up to it. */
               'ready',        c.id is null and case
                                 when t.metric = 'leaderboard_rank' then
                                   public.affiliate_task_progress(p_user_id, t.metric) > 0
                                   and public.affiliate_task_progress(p_user_id, t.metric) <= t.target
                                 else
                                   public.affiliate_task_progress(p_user_id, t.metric) >= t.target
                               end
             ) as x
        from public.affiliate_tasks t
        left join public.affiliate_task_completions c
          on c.task_id = t.id and c.user_id = p_user_id
       where t.is_active
    ) s;
$$;

-- ---------------------------------------------------------------------------
-- 6. Writes
-- ---------------------------------------------------------------------------

/**
 * One play, decided by the server.
 *
 * The client sends which game and nothing else. Weight, roll and the chosen
 * slot are all recorded so a disputed prize can be recomputed rather than
 * argued about.
 */
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

  select coalesce(sum(weight), 0) into v_total
    from public.affiliate_game_prizes
   where game = p_game and is_active;

  if v_total <= 0 then
    raise exception 'This game has no prizes set up' using errcode = 'check_violation';
  end if;

  /* `gen_random_bytes`, not `random()`: Postgres's PRNG is seeded and
     deterministic, and this decides money. Same rule as gift codes. */
  v_roll := (get_byte(extensions.gen_random_bytes(4), 0) * 16777216
           + get_byte(extensions.gen_random_bytes(4), 1) * 65536
           + get_byte(extensions.gen_random_bytes(4), 2) * 256
           + get_byte(extensions.gen_random_bytes(4), 3))::numeric
           / 4294967296::numeric * v_total;

  for v_prize in
    select * from public.affiliate_game_prizes
     where game = p_game and is_active
     order by slot
  loop
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

/**
 * Claiming a task, once and for all.
 *
 * The unique constraint is the guarantee; this catches its violation and says
 * so honestly rather than letting a duplicate key reach a person.
 */
create or replace function public.claim_affiliate_task(
  p_user_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task     public.affiliate_tasks;
  v_aff      uuid;
  v_progress bigint;
  v_ready    boolean;
begin
  select id into v_aff from public.affiliate_accounts where user_id = p_user_id;
  if v_aff is null then
    raise exception 'You are not an affiliate' using errcode = 'check_violation';
  end if;

  select * into v_task from public.affiliate_tasks where id = p_task_id and is_active;
  if not found then
    raise exception 'Unknown task' using errcode = 'check_violation';
  end if;

  v_progress := public.affiliate_task_progress(p_user_id, v_task.metric);
  v_ready := case
    when v_task.metric = 'leaderboard_rank' then v_progress > 0 and v_progress <= v_task.target
    else v_progress >= v_task.target
  end;

  if not v_ready then
    raise exception 'That is not finished yet' using errcode = 'check_violation';
  end if;

  begin
    insert into public.affiliate_task_completions
      (task_id, user_id, progress_at_claim, reward_minor)
    values (p_task_id, p_user_id, v_progress, v_task.reward_minor);
  exception when unique_violation then
    raise exception 'You have already claimed this one' using errcode = 'check_violation';
  end;

  if v_task.reward_minor > 0 then
    insert into public.commission_ledger
      (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
    values
      (v_aff, 'adjustment', v_task.reward_minor, 'cleared',
       'Task reward: ' || v_task.name,
       'affiliate-task-' || p_task_id::text || '-' || p_user_id::text);
  end if;

  return jsonb_build_object('ok', true, 'reward_minor', v_task.reward_minor);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants. ⚠️ `create function` re-grants EXECUTE to PUBLIC.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.affiliate_week_start()',
    'public.affiliate_weekly_play_allowance(uuid)',
    'public.affiliate_game_status(uuid)',
    'public.affiliate_leaderboard(text, int)',
    'public.affiliate_leaderboard_standing(uuid, text)',
    'public.affiliate_task_progress(uuid, public.affiliate_task_metric)',
    'public.get_affiliate_tasks(uuid)',
    'public.play_affiliate_game(uuid, public.affiliate_game_kind)',
    'public.claim_affiliate_task(uuid, uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Something to play for, and something to aim at
-- ---------------------------------------------------------------------------

insert into public.affiliate_game_prizes (game, slot, label, amount_minor, extra_plays, weight, colour)
values
  ('spin_wheel', 1, 'GHS 1',      100,  0, 32, '#7c3aed'),
  ('spin_wheel', 2, 'GHS 2',      200,  0, 24, '#0ea5e9'),
  ('spin_wheel', 3, 'GHS 5',      500,  0, 14, '#10b981'),
  ('spin_wheel', 4, 'One more go',  0,  1, 18, '#f59e0b'),
  ('spin_wheel', 5, 'GHS 10',    1000,  0,  8, '#ef4444'),
  ('spin_wheel', 6, 'GHS 25',    2500,  0,  4, '#eab308'),
  ('mystery_box', 1, 'GHS 1',     100,  0, 34, null),
  ('mystery_box', 2, 'GHS 3',     300,  0, 26, null),
  ('mystery_box', 3, 'GHS 5',     500,  0, 20, null),
  ('mystery_box', 4, 'One more go', 0,  1, 12, null),
  ('mystery_box', 5, 'GHS 20',   2000,  0,  8, null)
on conflict (game, slot) do nothing;

/* Rewards start at zero on purpose, exactly as the referral rates did: the
   shape is testable today and nothing leaves until the operator sets a
   figure. */
insert into public.affiliate_tasks (code, name, description, metric, target, reward_minor, icon, sort_order)
values
  ('first_sale',   'Make your first sale',      'Someone buys through your link.',                 'sales',            1,  0, '🎉', 10),
  ('five_sales',   'Five sales',                'Five purchases through your links.',              'sales',            5,  0, '🛒', 20),
  ('first_recruit','Bring in an affiliate',     'Somebody joins the programme through you.',        'referrals',        1,  0, '🤝', 30),
  ('play_a_game',  'Play a game',               'Use one of your weekly plays.',                    'games_played',     1,  0, '🎲', 40),
  ('top_ten',      'Reach the top ten',         'Finish in the top ten on the earnings board. Paid once.', 'leaderboard_rank', 10, 0, '🏆', 50)
on conflict (code) do nothing;
