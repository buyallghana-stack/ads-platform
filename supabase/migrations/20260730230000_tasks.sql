-- ============================================================================
-- Migration 078 — tasks: milestones a user completes for points
--
-- Operator brief, 2026-07-30: reward users for completing specific tasks or
-- reaching a milestone — buy a first plan, watch N ads, accumulate N points,
-- sign up, refer N people, play N games, enable 2FA, set a profile picture,
-- make a first withdrawal, set a withdrawal PIN. Every task has a name and a
-- description, shows progress where progress means anything, and the operator
-- can create more without me.
--
-- THE WHOLE DESIGN IS ONE SENTENCE: a task is a METRIC, a TARGET and a
-- REWARD. "Watch 50 ads" is ads_watched >= 50. "Add a withdrawal PIN" is
-- has_withdrawal_pin >= 1. There is no second kind of task and no boolean
-- column saying which sort this is — **a target of 1 simply renders as a tick
-- instead of a progress bar**, which is the operator's "shows progress if it
-- is not a one-time thing" rule falling out of the data for free.
--
-- That is also what makes it configurable without code: creating a task is
-- choosing a metric from a list and typing a number. Adding a genuinely new
-- KIND of goal means adding a metric here, which is the one thing that
-- rightly needs a migration.
--
-- FOUR OPERATOR DECISIONS:
--   1. CLAIM, not automatic. A finished task waits until the user taps it.
--   2. RETROACTIVE. Progress is computed from real history, so a new task is
--      immediately complete for anybody who already did the thing. ⚠️ This
--      means creating a task can pay every existing user at once — the admin
--      screen shows what a task would cost before it is saved.
--   3. POINTS ONLY.
--   4. ONE-TIME. Repeated effort is a ladder of tasks on one metric
--      (watch 10 / 50 / 200), which needs no extra mechanic.
--
-- ANTI-FARMING NOTE ON TWO METRICS, because a task pays real points:
--   * `referrals_activated` counts invitees who have WATCHED AT LEAST ONE AD,
--     not raw signups. Counting signups would pay somebody for creating
--     accounts, which is the exact fraud the device layer exists to catch.
--   * `withdrawals_made` counts redemptions actually PAID, not requested.
--     Requesting and cancelling in a loop must not complete a task.
-- ============================================================================


create type public.task_metric as enum (
  'account_created',
  'plans_purchased',
  'ads_watched',
  'surveys_completed',
  'points_earned',
  'referrals_activated',
  'games_played',
  'gift_codes_redeemed',
  'withdrawals_made',
  'has_2fa',
  'has_avatar',
  'has_withdrawal_pin'
);


create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  -- Stable handle for anything that ever needs to name a specific task in
  -- code. The operator never sees it; renaming the task never breaks it.
  code text not null unique
    check (code ~ '^[a-z][a-z0-9_]{2,40}$'),

  name text not null check (length(trim(name)) between 1 and 60),
  -- The operator asked for this explicitly: something the user can read to
  -- know a little more.
  description text not null check (length(trim(description)) between 1 and 300),

  metric public.task_metric not null,
  target bigint not null check (target >= 1),

  reward_points bigint not null check (reward_points > 0),

  -- Lucide icon name, chosen from a fixed list in the editor. Free text here
  -- because the set of icons is a front-end concern and a bad value degrades
  -- to a default rather than breaking anything.
  icon text not null default 'Target',

  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is
  'One row per milestone. A task is a metric, a target and a reward; target = 1 is a one-shot task and renders as a tick rather than a progress bar.';

create index tasks_active_idx on public.tasks (is_active, sort_order);

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- task_completions — claimed, once, per person
-- ---------------------------------------------------------------------------
--
-- The unique constraint is the guarantee, exactly as with gift codes: a
-- second claim of one task by one user is not refused, it is unrepresentable.

create table public.task_completions (
  id uuid primary key default gen_random_uuid(),

  task_id uuid not null references public.tasks (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- What the metric read at the moment of the claim, and what was paid.
  -- Recorded rather than looked up later: editing a task's reward afterwards
  -- must not rewrite what somebody already received.
  progress_at_claim bigint not null,
  reward_points     bigint not null check (reward_points > 0),

  claimed_at timestamptz not null default now(),

  unique (task_id, user_id)
);

comment on table public.task_completions is
  'One row per task claimed by a user. The unique constraint on (task_id, user_id) is what makes a second claim impossible, not the status check above it.';

create index task_completions_user_idx on public.task_completions (user_id, claimed_at desc);

alter table public.task_completions enable row level security;

create policy "Read own completions or all as admin"
  on public.task_completions for select
  using (user_id = auth.uid() or public.is_admin());

alter table public.tasks enable row level security;

-- Tasks are not secret — a user is shown all of them. The read goes through
-- `get_tasks` anyway, which attaches each person's own progress; this policy
-- exists so the table is not readable in bulk by a client for no reason.
create policy "Anyone signed in may read active tasks"
  on public.tasks for select
  using (is_active or public.is_admin());


-- ---------------------------------------------------------------------------
-- user_task_metric — the one definition of every measurable thing
-- ---------------------------------------------------------------------------
--
-- One function, one CASE, so the number a user sees on the progress bar and
-- the number `claim_task` checks against are the same number by construction.
-- Two separate queries would eventually disagree, and the day they did, a bar
-- would read "50 / 50" beside a button that refuses.
--
-- Every branch counts from history the platform already keeps, which is what
-- makes tasks retroactive with no extra machinery.

create or replace function public.user_task_metric(
  p_user_id uuid,
  p_metric  public.task_metric
)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v bigint;
begin
  case p_metric

    when 'account_created' then
      -- The "Newbie" task: satisfied by existing.
      select count(*) into v from public.profiles p where p.id = p_user_id;

    when 'plans_purchased' then
      select count(*) into v from public.subscription_payments s
       where s.user_id = p_user_id and s.status = 'confirmed';

    when 'ads_watched' then
      select count(*) into v from public.points_ledger l
       where l.user_id = p_user_id and l.entry_type = 'ad_view';

    when 'surveys_completed' then
      select count(*) into v from public.points_ledger l
       where l.user_id = p_user_id and l.entry_type = 'survey';

    when 'points_earned' then
      -- Lifetime earned, not the current balance: a task about reaching a
      -- total must not un-complete itself when somebody withdraws.
      select coalesce(b.lifetime_earned, 0) into v
        from public.user_balances b where b.user_id = p_user_id;

    when 'referrals_activated' then
      /* People they invited who have actually watched an ad. Counting raw
         signups would pay somebody for creating accounts. */
      select count(*) into v
        from public.profiles r
       where r.referred_by = p_user_id
         and r.deleted_at is null
         and exists (
           select 1 from public.points_ledger l
            where l.user_id = r.id and l.entry_type = 'ad_view'
         );

    when 'games_played' then
      select count(*) into v from public.game_plays g where g.user_id = p_user_id;

    when 'gift_codes_redeemed' then
      select count(*) into v from public.gift_code_redemptions r where r.user_id = p_user_id;

    when 'withdrawals_made' then
      -- PAID, not requested. Requesting and cancelling in a loop must not
      -- complete a task.
      select count(*) into v from public.redemptions d
       where d.user_id = p_user_id and d.status = 'paid';

    when 'has_2fa' then
      select count(*) into v from public.user_security s
       where s.user_id = p_user_id and s.totp_confirmed_at is not null;

    when 'has_avatar' then
      select count(*) into v from public.profiles p
       where p.id = p_user_id and p.avatar_path is not null;

    when 'has_withdrawal_pin' then
      select count(*) into v from public.user_security s
       where s.user_id = p_user_id and s.pin_hash is not null;

    else
      v := 0;
  end case;

  return coalesce(v, 0);
end;
$$;


-- ---------------------------------------------------------------------------
-- get_tasks — the screen, with this person's progress on it
-- ---------------------------------------------------------------------------
--
-- Self-scoped by auth.uid(); it takes no user id, so it cannot be pointed at
-- anybody else. Granted to `authenticated` because everything it returns is
-- either public (the task list) or the caller's own (their progress).

create or replace function public.get_tasks()
returns table (
  id            uuid,
  code          text,
  name          text,
  description   text,
  metric        public.task_metric,
  target        bigint,
  reward_points bigint,
  icon          text,
  progress      bigint,
  claimed_at    timestamptz,
  claimable     boolean
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
    t.id, t.code, t.name, t.description, t.metric, t.target, t.reward_points, t.icon,
    -- Capped at the target: a bar reading 812/50 is noise, and the number
    -- that matters after completion is that it is done.
    least(public.user_task_metric(v_me, t.metric), t.target),
    c.claimed_at,
    (c.id is null and public.user_task_metric(v_me, t.metric) >= t.target)
  from public.tasks t
  left join public.task_completions c
    on c.task_id = t.id and c.user_id = v_me
  where t.is_active
  order by
    -- Anything waiting to be claimed comes first: it is the only row on this
    -- screen that asks the user to do something.
    (c.id is null and public.user_task_metric(v_me, t.metric) >= t.target) desc,
    (c.id is not null),
    t.sort_order,
    t.created_at;
end;
$$;

revoke execute on function public.get_tasks() from public, anon;
grant execute on function public.get_tasks() to authenticated;


-- ---------------------------------------------------------------------------
-- claim_task — the money path
-- ---------------------------------------------------------------------------
--
-- The client sends a task id and nothing else. Whether it is finished is
-- decided here, from the same metric function the bar was drawn from.
--
-- Refusals come back as outcomes rather than exceptions: tapping a button
-- that has just become stale is an ordinary thing, not a fault.

create or replace function public.claim_task(
  p_user_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task     public.tasks;
  v_profile  public.profiles;
  v_progress bigint;
  v_id       uuid;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_profile.disabled_at is not null then
    return jsonb_build_object('outcome', 'account_disabled');
  end if;

  select * into v_task from public.tasks where id = p_task_id and is_active;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_progress := public.user_task_metric(p_user_id, v_task.metric);

  if v_progress < v_task.target then
    return jsonb_build_object(
      'outcome', 'not_finished',
      'progress', v_progress,
      'target', v_task.target
    );
  end if;

  /*
    THE GUARANTEE. Unique on (task_id, user_id) — a second claim cannot be
    written, by this function or any future one. Two taps a millisecond apart
    both reach here; one of them lands in this handler.
  */
  begin
    insert into public.task_completions (task_id, user_id, progress_at_claim, reward_points)
    values (v_task.id, p_user_id, v_progress, v_task.reward_points)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'already_claimed');
  end;

  perform public.credit_points(
    p_user_id, v_task.reward_points, 'task_reward', 'task', v_task.id::text,
    jsonb_build_object('code', v_task.code, 'name', v_task.name)
  );

  perform public.create_notification(
    p_user_id,
    'payout',
    'Task complete',
    v_task.name || ' — ' || v_task.reward_points::text || ' points added to your balance.',
    jsonb_build_object('task_id', v_task.id, 'points', v_task.reward_points)
  );

  return jsonb_build_object(
    'outcome', 'ok',
    'completion_id', v_id,
    'points', v_task.reward_points,
    'name', v_task.name
  );
end;
$$;

revoke execute on function public.claim_task(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
--
-- `eligible_now` is the number that stops a task being priced by feel. Tasks
-- are retroactive, so saving "watch 100 ads, 500 points" can owe every
-- long-standing user at once; this says how many people would be able to
-- claim it the moment it goes live, and the screen multiplies it by the
-- reward.

create or replace function public.admin_list_tasks(p_admin_id uuid)
returns table (
  id            uuid,
  code          text,
  name          text,
  description   text,
  metric        public.task_metric,
  target        bigint,
  reward_points bigint,
  icon          text,
  sort_order    integer,
  is_active     boolean,
  claimed_count bigint,
  points_paid   bigint,
  eligible_now  bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select
    t.id, t.code, t.name, t.description, t.metric, t.target, t.reward_points,
    t.icon, t.sort_order, t.is_active,
    (select count(*) from public.task_completions c where c.task_id = t.id),
    (select coalesce(sum(c.reward_points), 0)::bigint
       from public.task_completions c where c.task_id = t.id),
    (select count(*)
       from public.profiles p
      where p.deleted_at is null
        and p.disabled_at is null
        and not exists (
          select 1 from public.task_completions c
           where c.task_id = t.id and c.user_id = p.id
        )
        and public.user_task_metric(p.id, t.metric) >= t.target)
  from public.tasks t
  order by t.sort_order, t.created_at;
end;
$$;

revoke execute on function public.admin_list_tasks(uuid) from public, anon, authenticated;


create or replace function public.admin_save_task(
  p_admin_id uuid,
  p_task     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_task->>'id', '')::uuid;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.tasks
      (code, name, description, metric, target, reward_points, icon, sort_order, is_active)
    values (
      lower(trim(p_task->>'code')),
      trim(p_task->>'name'),
      trim(p_task->>'description'),
      (p_task->>'metric')::public.task_metric,
      greatest(coalesce((p_task->>'target')::bigint, 1), 1),
      coalesce((p_task->>'reward_points')::bigint, 1),
      coalesce(nullif(trim(p_task->>'icon'), ''), 'Target'),
      coalesce((p_task->>'sort_order')::int, 0),
      coalesce((p_task->>'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    /*
      The METRIC and the TARGET are frozen once anybody has claimed the task.
      Moving the goalposts under people who already finished would leave
      completions recording something that never happened, and the ones who
      claimed a 50-ad task cannot be un-paid because it now says 500.
    */
    if exists (select 1 from public.task_completions where task_id = v_id)
       and exists (
         select 1 from public.tasks t
          where t.id = v_id
            and (t.metric <> (p_task->>'metric')::public.task_metric
                 or t.target <> coalesce((p_task->>'target')::bigint, t.target))
       )
    then
      raise exception 'People have already completed this task, so its goal cannot change. Create a new task instead.'
        using errcode = 'check_violation';
    end if;

    update public.tasks set
      name          = trim(p_task->>'name'),
      description   = trim(p_task->>'description'),
      metric        = (p_task->>'metric')::public.task_metric,
      target        = greatest(coalesce((p_task->>'target')::bigint, 1), 1),
      reward_points = coalesce((p_task->>'reward_points')::bigint, reward_points),
      icon          = coalesce(nullif(trim(p_task->>'icon'), ''), 'Target'),
      sort_order    = coalesce((p_task->>'sort_order')::int, sort_order),
      is_active     = coalesce((p_task->>'is_active')::boolean, is_active)
    where id = v_id;

    if not found then
      raise exception 'No such task' using errcode = 'check_violation';
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_save_task(uuid, jsonb) from public, anon, authenticated;


-- Deletes only while nobody has claimed it; otherwise deactivates, because
-- `task_completions.task_id` is ON DELETE RESTRICT — the record of what
-- somebody was paid must outlive a change of mind about the task.
create or replace function public.admin_delete_task(
  p_admin_id uuid,
  p_task_id  uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  if exists (select 1 from public.task_completions where task_id = p_task_id) then
    update public.tasks set is_active = false where id = p_task_id;
    return 'archived';
  end if;

  delete from public.tasks where id = p_task_id;
  return 'deleted';
end;
$$;

revoke execute on function public.admin_delete_task(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- A starting set covering every example the operator gave
-- ---------------------------------------------------------------------------
--
-- Rewards are deliberately modest — roughly a tenth of what the equivalent
-- effort earns from ads — because tasks pay for things a user was going to do
-- anyway. The operator re-prices all of it from the admin screen.

insert into public.tasks
  (code, name, description, metric, target, reward_points, icon, sort_order)
values
  ('newbie', 'Newbie', 'Welcome to SidePerks. You earned this one just by joining us — claim it and you are on the board.', 'account_created', 1, 200, 'Sparkles', 10),
  ('profile_photo', 'Put a face to the name', 'Add a profile picture from Profile → Personal info. It is how friends spot you on the leaderboard.', 'has_avatar', 1, 100, 'Camera', 20),
  ('first_ads', 'Getting started', 'Watch your first 10 ads. This is the core of how SidePerks pays — everything else is a bonus on top.', 'ads_watched', 10, 300, 'PlayCircle', 30),
  ('hundred_ads', 'Regular', 'Watch 100 ads in total. No rush — this one counts everything you have ever watched.', 'ads_watched', 100, 1500, 'PlayCircle', 40),
  ('first_survey', 'Have your say', 'Complete your first survey. Advertisers pay more for an opinion than for a view.', 'surveys_completed', 1, 250, 'ListChecks', 50),
  ('withdrawal_pin', 'Lock the door', 'Set your 4-digit withdrawal PIN from Profile → Security. Nothing leaves your balance without it.', 'has_withdrawal_pin', 1, 300, 'KeyRound', 60),
  ('two_factor', 'Double locked', 'Turn on two-factor authentication with an authenticator app. It is the strongest protection your account can have.', 'has_2fa', 1, 500, 'ShieldCheck', 70),
  ('first_plan', 'Level up', 'Buy your first plan. Higher plans lift your daily ad limit, multiply what each ad pays and lower your payout minimum.', 'plans_purchased', 1, 1000, 'Gem', 80),
  ('five_thousand', 'Five thousand club', 'Earn 5,000 points in total. Counts everything you have ever earned, whether you have withdrawn it or not.', 'points_earned', 5000, 750, 'Coins', 90),
  ('three_referrals', 'Bring your people', 'Invite 3 people who go on to watch at least one ad. Sharing your code is the fastest way to earn here.', 'referrals_activated', 3, 1500, 'Users', 100),
  ('first_withdrawal', 'Cash out', 'Make your first withdrawal and have it paid. This is the whole point — claim it once the money reaches you.', 'withdrawals_made', 1, 500, 'Wallet', 110),
  ('play_five_games', 'Feeling lucky', 'Play 5 games — the mystery box and the wheel both count towards this.', 'games_played', 5, 400, 'Gamepad2', 120)
on conflict (code) do nothing;
