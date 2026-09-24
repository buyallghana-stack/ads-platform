-- ============================================================================
-- Migration 249 - team milestones, built on the task system
--
-- Operator brief, 2026-09-24: pay a cash reward when the number of qualifying
-- members on somebody's team reaches 5, 10, 15, 40, 80, 150, 250, 400, 600,
-- 850 and 1,200. Each figure the operator gave is the TOTAL a person holds at
-- that rung, and a rung pays only the difference from what they already have:
-- reaching all eleven pays GHS 300,000, not the GHS 476,450 the figures add
-- up to.
--
-- NOT A SECOND REWARD SYSTEM. A milestone is a task: a metric, a target and a
-- reward, claimed once, guarded by the unique (task_id, user_id) constraint
-- that already guards every task. The operator edits the ladder on the admin
-- Tasks screen like any other task. What is new is small:
--
--   1. A METRIC, `team_members`: people on both levels of somebody's team
--      holding an active paid plan RIGHT NOW (operator's choice of the three
--      definitions offered). The count can go down when plans expire.
--
--   2. A FLAG, `tasks.cumulative`. On a cumulative task `reward_points` is the
--      TOTAL at that rung, and claiming pays
--          rung total - everything already paid on this ladder
--      Keeping the totals, not the steps, is what the operator asked for, and
--      it is the robust choice: if a total is edited later, the next claim
--      tops the person up to the new figure instead of stacking a step on top
--      of an old one.
--
--   3. A CLAIM THAT TAKES THE WHOLE LADDER. One tap claims every rung the
--      person has reached and not yet claimed, lowest first, each in its own
--      completion row. Somebody jumping from 4 members to 40 gets four rows
--      paying 50 + 50 + 100 + 400 = 600, which is the GHS 600 total at 40.
--
-- WHY A RUNG CAN NEVER PAY TWICE, even though the count can fall and rise:
--   * unique (task_id, user_id) on task_completions: a second completion of a
--     rung cannot be written, by this function or any future one.
--   * points_ledger_source_once_idx on (user, 'task_reward', 'task', task id):
--     a second credit for the same rung cannot be written either.
--   * a per-person advisory lock around the ladder claim, so two taps in the
--     same millisecond are served one after the other and the second finds
--     nothing left to claim.
--   * the payment is computed from what was PAID, not from the rung below,
--     so no edit to the ladder can make the sum exceed the highest total.
--   Dropping back below a rung does not reopen it, and nothing is clawed back:
--   the brief asks for no claw-back and none of the existing rules require one.
--
-- SEPARATE FROM REFERRAL COMMISSIONS. Nothing here reads or writes
-- referral_commissions, and the commission code does not read task rewards.
-- The credit is an ordinary `task_reward` ledger entry, marked `milestone` in
-- its metadata.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists cumulative boolean not null default false;

comment on column public.tasks.cumulative is
  'A milestone rung. reward_points is the TOTAL a person holds once they reach this rung, and claiming pays that total minus everything already paid on cumulative tasks with the same metric. Frozen once anybody has claimed.';

-- What the ladder looked like at the moment of each claim, recorded rather
-- than recomputed: editing the ladder later must not rewrite the history of
-- what somebody was paid and why.
alter table public.task_completions
  add column if not exists previous_total_points  bigint,
  add column if not exists milestone_total_points bigint;

comment on column public.task_completions.previous_total_points is
  'Milestone rungs only: what had been paid on this ladder before this rung. reward_points = milestone_total_points - previous_total_points.';
comment on column public.task_completions.milestone_total_points is
  'Milestone rungs only: the rung''s total value when it was claimed.';

/* A milestone rung can pay ZERO: if the operator lowers a total below what a
   person has already been paid, reaching that rung pays nothing but still
   has to be recorded as done, or it would sit there claimable forever. An
   ordinary task still must pay something. */
alter table public.task_completions
  drop constraint if exists task_completions_reward_points_check;
alter table public.task_completions
  add constraint task_completions_reward_points_check
  check (reward_points > 0 or (reward_points = 0 and milestone_total_points is not null));

create index if not exists tasks_ladder_idx
  on public.tasks (metric, target) where cumulative;


-- ---------------------------------------------------------------------------
-- 2. The metric
-- ---------------------------------------------------------------------------
--
-- Restated in full because a CASE cannot be amended, with ONE new branch. The
-- other branches are copied from the live definition (pg_get_functiondef on
-- 2026-09-24), not from an older migration file.

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
      select coalesce(b.lifetime_earned, 0) into v
        from public.user_balances b where b.user_id = p_user_id;

    when 'referrals_purchased' then
      /* Invitees who bought a plan, counted ONCE EACH. Twenty purchased
         plans means twenty referred people — somebody stacking four plans is
         still one referral, which is why this counts profiles and not
         payments. */
      select count(*) into v
        from public.profiles r
       where r.referred_by = p_user_id
         and r.deleted_at is null
         and exists (
           select 1 from public.subscription_payments s
            where s.user_id = r.id and s.status = 'confirmed'
         );

    when 'team_members' then
      /* Both levels of the team (team_member_ids: one join deep, rejected
         links and cycles already excluded), counting a person only while they
         HOLD a paid plan: active or in grace, on anything but the free tier.
         The same test the Team screen uses for "plans they hold", so the two
         screens cannot disagree about who is on a plan. Counted once each,
         however many plans they stack. A disabled or deleted member does not
         count: a farm that gets caught must not keep its milestone progress. */
      select count(distinct m.member_id) into v
        from public.team_member_ids(p_user_id) m
        join public.profiles pr on pr.id = m.member_id
       where pr.deleted_at is null
         and pr.disabled_at is null
         and exists (
           select 1
             from public.user_subscriptions us
             join public.tiers t on t.id = us.tier_id
            where us.user_id = m.member_id
              and us.status in ('active', 'grace')
              and not t.is_default
         );

    when 'vault_deposits_made' then
      /* Count of vault investments funded by the user */
      select count(*) into v
        from public.vault_investments vi
       where vi.user_id = p_user_id;

    when 'games_played' then
      select count(*) into v from public.game_plays g where g.user_id = p_user_id;

    when 'gift_codes_redeemed' then
      select count(*) into v from public.gift_code_redemptions r where r.user_id = p_user_id;

    when 'withdrawals_made' then
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
-- 3. claim_task: an ordinary task exactly as before, a milestone by ladder
-- ---------------------------------------------------------------------------

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
  v_rung     public.tasks;
  v_paid     bigint;
  v_pay      bigint;
  v_total    bigint := 0;
  v_rungs    int := 0;
  v_top      public.tasks;
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

  /* A milestone ladder is claimed as a whole. Serialise it per person BEFORE
     reading anything: the amount a rung pays depends on what the rungs below
     it paid, so two concurrent claims must not both read "nothing paid yet". */
  if v_task.cumulative then
    perform pg_advisory_xact_lock(
      hashtextextended('task_ladder:' || p_user_id::text || ':' || v_task.metric::text, 0)
    );
  end if;

  v_progress := public.user_task_metric(p_user_id, v_task.metric);

  if v_progress < v_task.target then
    return jsonb_build_object(
      'outcome', 'not_finished',
      'progress', v_progress,
      'target', v_task.target
    );
  end if;

  if not v_task.cumulative then
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
      v_task.name || ': ' || v_task.reward_points::text || ' points added to your balance.',
      jsonb_build_object('task_id', v_task.id, 'points', v_task.reward_points)
    );

    return jsonb_build_object(
      'outcome', 'ok',
      'completion_id', v_id,
      'points', v_task.reward_points,
      'name', v_task.name
    );
  end if;

  /* ---- A milestone ladder ------------------------------------------------
     What has been PAID on this ladder so far, archived rungs included: money
     already paid is paid whatever happened to the rung afterwards. */
  select coalesce(sum(c.reward_points), 0)::bigint into v_paid
    from public.task_completions c
    join public.tasks t on t.id = c.task_id
   where c.user_id = p_user_id
     and t.cumulative
     and t.metric = v_task.metric;

  for v_rung in
    select t.*
      from public.tasks t
     where t.cumulative
       and t.is_active
       and t.metric = v_task.metric
       and t.target <= v_progress
       and not exists (
         select 1 from public.task_completions c
          where c.task_id = t.id and c.user_id = p_user_id
       )
     order by t.target, t.reward_points
  loop
    v_pay := greatest(v_rung.reward_points - v_paid, 0);

    -- The same guarantee as an ordinary task. Under the lock this cannot
    -- collide, so a collision here is a real fault and is allowed to raise,
    -- which rolls back every rung and every credit of this claim together.
    insert into public.task_completions
      (task_id, user_id, progress_at_claim, reward_points,
       previous_total_points, milestone_total_points)
    values
      (v_rung.id, p_user_id, v_progress, v_pay, v_paid, v_rung.reward_points);

    if v_pay > 0 then
      perform public.credit_points(
        p_user_id, v_pay, 'task_reward', 'task', v_rung.id::text,
        jsonb_build_object(
          'code', v_rung.code,
          'name', v_rung.name,
          'milestone', true,
          'target', v_rung.target,
          'previous_total_points', v_paid,
          'milestone_total_points', v_rung.reward_points
        )
      );
    end if;

    v_paid  := v_paid + v_pay;
    v_total := v_total + v_pay;
    v_rungs := v_rungs + 1;
    v_top   := v_rung;
  end loop;

  if v_rungs = 0 then
    return jsonb_build_object('outcome', 'already_claimed');
  end if;

  if v_total > 0 then
    perform public.create_notification(
      p_user_id,
      'payout',
      'Team milestone reached',
      v_top.name || ': ' || v_total::text || ' points added to your balance.',
      jsonb_build_object('task_id', v_top.id, 'points', v_total, 'rungs', v_rungs)
    );
  end if;

  return jsonb_build_object(
    'outcome', 'ok',
    'points', v_total,
    'name', v_top.name,
    'rungs', v_rungs
  );
end;
$$;

revoke execute on function public.claim_task(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. get_tasks leaves the ladder out
-- ---------------------------------------------------------------------------
--
-- On a milestone rung reward_points is a TOTAL, so a card reading "+50,000"
-- beside "+100,000" would promise money the ladder does not pay. Milestones
-- get their own panel (team_milestones below) that shows what each rung
-- actually pays. Same signature, so the existing grant stands.

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
    and not t.cumulative
  order by
    -- Anything waiting to be claimed comes first: it is the only row on this
    -- screen that asks the user to do something.
    (c.id is null and public.user_task_metric(v_me, t.metric) >= t.target) desc,
    (c.id is not null),
    t.sort_order,
    t.created_at;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. team_milestones: everything the milestone panel shows, for one person
-- ---------------------------------------------------------------------------
--
-- The subject is an ARGUMENT, never auth.uid(): the admin's "view as" reads
-- the person being viewed, and an auth.uid() read would answer for the admin
-- instead. So it is revoked from every client role and called through the
-- service client, by a server that has already decided who may ask.
--
-- Money figures come back in POINTS with the peg beside them; the screen
-- converts, so there is one conversion and it is the one every other screen
-- uses.

create or replace function public.team_milestones(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count     bigint := public.user_task_metric(p_user_id, 'team_members');
  v_paid      bigint;
  v_reached   public.tasks;
  v_next      public.tasks;
  v_claimable uuid;
  v_owed      bigint;
  v_rungs     jsonb;
  v_history   jsonb;
begin
  select coalesce(sum(c.reward_points), 0)::bigint into v_paid
    from public.task_completions c
    join public.tasks t on t.id = c.task_id
   where c.user_id = p_user_id and t.cumulative and t.metric = 'team_members';

  -- The highest rung the CURRENT count reaches. Can be lower than the highest
  -- rung ever claimed when plans expire; the history keeps that one.
  select * into v_reached
    from public.tasks t
   where t.cumulative and t.is_active and t.metric = 'team_members' and t.target <= v_count
   order by t.target desc, t.reward_points desc
   limit 1;

  select * into v_next
    from public.tasks t
   where t.cumulative and t.is_active and t.metric = 'team_members' and t.target > v_count
   order by t.target, t.reward_points
   limit 1;

  -- A reached rung nobody has claimed yet: the task id the Claim button sends.
  select t.id into v_claimable
    from public.tasks t
   where t.cumulative and t.is_active and t.metric = 'team_members' and t.target <= v_count
     and not exists (select 1 from public.task_completions c
                      where c.task_id = t.id and c.user_id = p_user_id)
   order by t.target
   limit 1;

  -- What that claim would pay now: the highest reached total, less what has
  -- been paid. Zero when there is nothing to claim.
  v_owed := case when v_claimable is null then 0
                 else greatest(coalesce(v_reached.reward_points, 0) - v_paid, 0) end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'name', r.name,
           'target', r.target,
           'total_points', r.reward_points,
           'step_points', greatest(r.reward_points - coalesce(r.prev_total, 0), 0),
           'claimed_at', r.claimed_at,
           'paid_points', r.paid
         ) order by r.target), '[]'::jsonb)
    into v_rungs
    from (
      select t.id, t.name, t.target, t.reward_points,
             lag(t.reward_points) over (order by t.target, t.reward_points) as prev_total,
             c.claimed_at, c.reward_points as paid
        from public.tasks t
        left join public.task_completions c on c.task_id = t.id and c.user_id = p_user_id
       where t.cumulative and t.is_active and t.metric = 'team_members'
    ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', c.task_id,
           'name', t.name,
           'target', t.target,
           'members_at_claim', c.progress_at_claim,
           'previous_total_points', c.previous_total_points,
           'milestone_total_points', c.milestone_total_points,
           'paid_points', c.reward_points,
           'claimed_at', c.claimed_at
         ) order by c.claimed_at desc, t.target desc), '[]'::jsonb)
    into v_history
    from public.task_completions c
    join public.tasks t on t.id = c.task_id
   where c.user_id = p_user_id and t.cumulative and t.metric = 'team_members';

  return jsonb_build_object(
    'team_members', v_count,
    'points_per_unit', greatest(coalesce(public.config_int('points_per_currency_unit'), 100), 1),
    'paid_points', v_paid,
    'current', case when v_reached.id is null then null else jsonb_build_object(
                 'target', v_reached.target, 'total_points', v_reached.reward_points) end,
    'next', case when v_next.id is null then null else jsonb_build_object(
              'target', v_next.target,
              'total_points', v_next.reward_points,
              'needed', v_next.target - v_count,
              /* Measured from what they will hold once anything claimable
                 now has been claimed, so it is the amount that rung adds. */
              'payout_points', greatest(v_next.reward_points
                                 - greatest(v_paid, coalesce(v_reached.reward_points, 0)), 0)) end,
    'claimable_task_id', v_claimable,
    'claimable_points', v_owed,
    'rungs', v_rungs,
    'history', v_history
  );
end;
$$;

revoke execute on function public.team_milestones(uuid) from public, anon, authenticated;
grant execute on function public.team_milestones(uuid) to service_role;


-- The admin's copy: the same payload, behind assert_admin, for the person
-- panel on the Users screen.
create or replace function public.admin_team_milestones(p_admin_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);
  return public.team_milestones(p_user_id);
end;
$$;

revoke execute on function public.admin_team_milestones(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_team_milestones(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 6. Admin: the list says which tasks are rungs, the editor sets it
-- ---------------------------------------------------------------------------
--
-- admin_list_tasks gains a column, which changes its return type, so it is
-- dropped and created, and the default PUBLIC grant a fresh function gets is
-- taken away again straight after.

drop function if exists public.admin_list_tasks(uuid);

create function public.admin_list_tasks(p_admin_id uuid)
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
  cumulative    boolean,
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
    t.icon, t.sort_order, t.is_active, t.cumulative,
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
grant execute on function public.admin_list_tasks(uuid) to service_role;


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
  v_id         uuid := nullif(p_task->>'id', '')::uuid;
  v_cumulative boolean := coalesce((p_task->>'cumulative')::boolean, false);
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.tasks
      (code, name, description, metric, target, reward_points, icon, sort_order, is_active, cumulative)
    values (
      lower(trim(p_task->>'code')),
      trim(p_task->>'name'),
      trim(p_task->>'description'),
      (p_task->>'metric')::public.task_metric,
      greatest(coalesce((p_task->>'target')::bigint, 1), 1),
      coalesce((p_task->>'reward_points')::bigint, 1),
      coalesce(nullif(trim(p_task->>'icon'), ''), 'Target'),
      coalesce((p_task->>'sort_order')::int, 0),
      coalesce((p_task->>'is_active')::boolean, true),
      v_cumulative
    )
    returning id into v_id;
  else
    /*
      The METRIC, the TARGET and whether it is a MILESTONE RUNG are frozen once
      anybody has claimed the task. Moving the goalposts under people who
      already finished would leave completions recording something that never
      happened; turning a rung into an ordinary task (or back) would change
      what its reward_points MEAN after people were paid by one reading.
    */
    if exists (select 1 from public.task_completions where task_id = v_id)
       and exists (
         select 1 from public.tasks t
          where t.id = v_id
            and (t.metric <> (p_task->>'metric')::public.task_metric
                 or t.target <> coalesce((p_task->>'target')::bigint, t.target)
                 or t.cumulative <> coalesce((p_task->>'cumulative')::boolean, t.cumulative))
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
      is_active     = coalesce((p_task->>'is_active')::boolean, is_active),
      cumulative    = coalesce((p_task->>'cumulative')::boolean, cumulative)
    where id = v_id;

    if not found then
      raise exception 'No such task' using errcode = 'check_violation';
    end if;
  end if;

  /* A ladder has to climb. Two rungs at one target would make "the rung you
     reached" ambiguous, and a higher rung with a smaller total would pay
     nothing while promising something. Checked over the whole ladder after
     the write, so a save that breaks it is refused whichever rung it edits. */
  if exists (
    select 1
      from public.tasks a
      join public.tasks b
        on b.metric = a.metric and b.cumulative and b.is_active and b.id <> a.id
     where a.cumulative and a.is_active
       and a.metric = (select metric from public.tasks where id = v_id)
       and (a.target = b.target or (a.target < b.target and a.reward_points >= b.reward_points))
  ) then
    raise exception 'Milestone rungs must climb: each rung needs a higher member count and a higher total than the one below it.'
      using errcode = 'check_violation';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_save_task(uuid, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. The ladder the operator gave, in points at today's peg
-- ---------------------------------------------------------------------------
--
-- reward_points is the TOTAL at each rung. Converted from cedis at the live
-- peg so GHS 50 is GHS 50 on the day it goes in; the operator re-prices any
-- rung from the admin Tasks screen. `on conflict do nothing` so a re-run
-- never overwrites a figure the operator has since changed.

insert into public.tasks
  (code, name, description, metric, target, reward_points, icon, sort_order, cumulative)
select
  'team_milestone_' || m.members,
  'Team of ' || to_char(m.members, 'FM9,999'),
  /* No amount in the wording: the operator can re-price a rung, and a
     description quoting the old figure would then be a false promise. */
  'Reach ' || to_char(m.members, 'FM9,999')
    || ' team members on an active paid plan. People you invited and the people they invited both count.',
  'team_members',
  m.members,
  m.ghs * greatest(coalesce(public.config_int('points_per_currency_unit'), 100), 1),
  m.icon,
  200 + m.n,
  true
from (values
  (1,    5,     50, '🤝'),
  (2,   10,    100, '👥'),
  (3,   15,    200, '🔥'),
  (4,   40,    600, '⭐'),
  (5,   80,   1500, '🚀'),
  (6,  150,   3500, '💎'),
  (7,  250,   8000, '🏅'),
  (8,  400,  17500, '🏆'),
  (9,  600,  45000, '👑'),
  (10, 850, 100000, '🌍'),
  (11, 1200, 300000, '🌟')
) as m(n, members, ghs, icon)
on conflict (code) do nothing;
