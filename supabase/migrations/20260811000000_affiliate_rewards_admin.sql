-- ---------------------------------------------------------------------------
-- Setting what the affiliate games and tasks actually pay.
--
-- Everything built on 2026-08-07 shipped inert: five tasks paying GHS 0.00 and
-- a prize table of amounts I invented, with no way to change either short of
-- SQL. These are the functions behind the screen that fixes that.
--
-- Mirrors `admin_save_game_prizes` / `admin_save_task` deliberately, including
-- their guards, because the failure modes are identical and the Phase 1 ones
-- were learned the hard way. What is NOT mirrored is the currency: every
-- figure here is pesewas.
--
-- ⚠️ EVERY FUNCTION TAKES THE ACTING ADMIN AND CALLS `assert_admin`, which is
-- SUPER admin only. These decide how much real money leaves through a prize
-- draw, so they fail closed even if a screen is ever mounted in the wrong
-- route group.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Prizes
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_affiliate_prizes(
  p_admin_id uuid,
  p_game public.affiliate_game_kind
)
returns table (
  id uuid,
  slot int,
  label text,
  amount_minor bigint,
  extra_plays int,
  weight int,
  colour text,
  weekly_cap int,
  is_active boolean,
  times_won bigint,
  paid_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select p.id, p.slot, p.label, p.amount_minor, p.extra_plays, p.weight, p.colour,
         p.weekly_cap, p.is_active,
         (select count(*) from public.affiliate_game_plays g where g.prize_id = p.id),
         (select coalesce(sum(g.amount_minor), 0)::bigint
            from public.affiliate_game_plays g where g.prize_id = p.id)
    from public.affiliate_game_prizes p
   where p.game = p_game
   order by p.slot;
end;
$$;

/**
 * Save a whole prize table at once.
 *
 * One statement for the table rather than a call per row, because the odds are
 * a property of the SET: saving six rows one at a time means five moments in
 * which the wheel is a different game from the one the operator is looking at.
 */
create or replace function public.admin_save_affiliate_prizes(
  p_admin_id uuid,
  p_game     public.affiliate_game_kind,
  p_prizes   jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    jsonb;
  v_count  int := 0;
  v_id     uuid;
  v_owner  public.affiliate_game_kind;
  v_active int;
begin
  perform public.assert_admin(p_admin_id);

  if jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) = 0 then
    raise exception 'A game needs at least one prize' using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(p_prizes) loop
    v_id := nullif(v_row->>'id', '')::uuid;

    if v_id is null then
      insert into public.affiliate_game_prizes
        (game, slot, label, amount_minor, extra_plays, weight, colour, weekly_cap, is_active)
      values
        (p_game,
         (v_row->>'slot')::int,
         trim(v_row->>'label'),
         greatest(coalesce((v_row->>'amount_minor')::bigint, 0), 0),
         greatest(coalesce((v_row->>'extra_plays')::int, 0), 0),
         greatest(coalesce((v_row->>'weight')::int, 1), 1),
         nullif(trim(coalesce(v_row->>'colour', '')), ''),
         nullif((v_row->>'weekly_cap')::int, 0),
         coalesce((v_row->>'is_active')::boolean, true));
    else
      /* The row must belong to the game being saved. Without this, a payload
         naming another game's prize id would edit that game's table from this
         screen, which is the sort of thing nobody notices until the odds are
         wrong somewhere else. */
      select game into v_owner from public.affiliate_game_prizes where id = v_id;
      if v_owner is null or v_owner <> p_game then
        raise exception 'That prize does not belong to this game'
          using errcode = 'check_violation';
      end if;

      update public.affiliate_game_prizes
         set slot         = (v_row->>'slot')::int,
             label        = trim(v_row->>'label'),
             amount_minor = greatest(coalesce((v_row->>'amount_minor')::bigint, 0), 0),
             extra_plays  = greatest(coalesce((v_row->>'extra_plays')::int, 0), 0),
             weight       = greatest(coalesce((v_row->>'weight')::int, 1), 1),
             colour       = nullif(trim(coalesce(v_row->>'colour', '')), ''),
             weekly_cap   = nullif((v_row->>'weekly_cap')::int, 0),
             is_active    = coalesce((v_row->>'is_active')::boolean, true),
             updated_at   = now()
       where id = v_id;
    end if;

    v_count := v_count + 1;
  end loop;

  /* A game with nothing drawable is a button that raises an exception at the
     person who pressed it. Refuse the save instead. */
  select count(*) into v_active
    from public.affiliate_game_prizes
   where game = p_game and is_active and weight > 0;

  if v_active = 0 then
    raise exception 'At least one prize has to be active with a weight above zero'
      using errcode = 'check_violation';
  end if;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tasks
-- ---------------------------------------------------------------------------

/**
 * What a task has cost so far, and what it would cost the moment it is saved.
 *
 * `eligible_now` is the number that matters and the one an operator cannot
 * work out in their head: affiliate tasks are RETROACTIVE, so setting a reward
 * on "make your first sale" pays everybody who has ever made one, the instant
 * they open the screen. Showing that before the save is the whole point.
 */
create or replace function public.admin_list_affiliate_tasks(p_admin_id uuid)
returns table (
  id uuid,
  code text,
  name text,
  description text,
  metric public.affiliate_task_metric,
  target int,
  reward_minor bigint,
  icon text,
  sort_order int,
  is_active boolean,
  claimed_count bigint,
  paid_minor bigint,
  eligible_now bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select t.id, t.code, t.name, t.description, t.metric, t.target, t.reward_minor,
         t.icon, t.sort_order, t.is_active,
         (select count(*) from public.affiliate_task_completions c where c.task_id = t.id),
         (select coalesce(sum(c.reward_minor), 0)::bigint
            from public.affiliate_task_completions c where c.task_id = t.id),
         (select count(*)
            from public.affiliate_accounts a
            join public.profiles p on p.id = a.user_id
           where p.deleted_at is null
             and p.disabled_at is null
             and not exists (
               select 1 from public.affiliate_task_completions c
                where c.task_id = t.id and c.user_id = a.user_id
             )
             and case
                   when t.metric = 'leaderboard_rank' then
                     public.affiliate_task_progress(a.user_id, t.metric) > 0
                     and public.affiliate_task_progress(a.user_id, t.metric) <= t.target
                   else
                     public.affiliate_task_progress(a.user_id, t.metric) >= t.target
                 end)
    from public.affiliate_tasks t
   order by t.sort_order, t.name;
end;
$$;

/**
 * What a target WOULD expose, before the task exists or before it changes.
 *
 * Same question as `eligible_now`, asked about a target the operator is still
 * typing. Kept separate so the screen can answer it without saving anything.
 */
create or replace function public.admin_affiliate_task_exposure(
  p_admin_id uuid,
  p_metric   public.affiliate_task_metric,
  p_target   int,
  p_task_id  uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_people bigint;
begin
  perform public.assert_admin(p_admin_id);

  select count(*) into v_people
    from public.affiliate_accounts a
    join public.profiles p on p.id = a.user_id
   where p.deleted_at is null
     and p.disabled_at is null
     and (p_task_id is null or not exists (
       select 1 from public.affiliate_task_completions c
        where c.task_id = p_task_id and c.user_id = a.user_id
     ))
     and case
           when p_metric = 'leaderboard_rank' then
             public.affiliate_task_progress(a.user_id, p_metric) > 0
             and public.affiliate_task_progress(a.user_id, p_metric) <= p_target
           else
             public.affiliate_task_progress(a.user_id, p_metric) >= p_target
         end;

  return jsonb_build_object('people', v_people);
end;
$$;

create or replace function public.admin_save_affiliate_task(
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

  if coalesce(trim(p_task->>'name'), '') = '' then
    raise exception 'A task needs a name' using errcode = 'check_violation';
  end if;

  if v_id is null then
    insert into public.affiliate_tasks
      (code, name, description, metric, target, reward_minor, icon, sort_order, is_active)
    values (
      lower(regexp_replace(coalesce(nullif(trim(p_task->>'code'), ''), trim(p_task->>'name')),
                           '[^a-zA-Z0-9]+', '_', 'g')),
      trim(p_task->>'name'),
      nullif(trim(coalesce(p_task->>'description', '')), ''),
      (p_task->>'metric')::public.affiliate_task_metric,
      greatest(coalesce((p_task->>'target')::int, 1), 1),
      greatest(coalesce((p_task->>'reward_minor')::bigint, 0), 0),
      nullif(trim(coalesce(p_task->>'icon', '')), ''),
      coalesce((p_task->>'sort_order')::int, 0),
      coalesce((p_task->>'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    /* The METRIC is deliberately not updatable once claims exist: changing
       what a task measures after somebody has been paid for it rewrites
       history, and the completion row records progress against the old
       meaning. Everything else can move. */
    if exists (select 1 from public.affiliate_task_completions where task_id = v_id)
       and (p_task->>'metric') is not null
       and (p_task->>'metric')::public.affiliate_task_metric
           <> (select metric from public.affiliate_tasks where id = v_id) then
      raise exception 'This task has already been claimed, so what it measures cannot change'
        using errcode = 'check_violation';
    end if;

    update public.affiliate_tasks
       set name         = trim(p_task->>'name'),
           description  = nullif(trim(coalesce(p_task->>'description', '')), ''),
           metric       = coalesce((p_task->>'metric')::public.affiliate_task_metric, metric),
           target       = greatest(coalesce((p_task->>'target')::int, target), 1),
           reward_minor = greatest(coalesce((p_task->>'reward_minor')::bigint, reward_minor), 0),
           icon         = nullif(trim(coalesce(p_task->>'icon', '')), ''),
           sort_order   = coalesce((p_task->>'sort_order')::int, sort_order),
           is_active    = coalesce((p_task->>'is_active')::boolean, is_active),
           updated_at   = now()
     where id = v_id;
  end if;

  return v_id;
end;
$$;

/**
 * Deleting, or archiving when deleting would erase a payment.
 *
 * Same rule as Phase 1: a task somebody has been paid for is part of the
 * record. It goes inactive instead, and the caller is told which happened so
 * the screen can say so rather than implying the row is gone.
 */
create or replace function public.admin_delete_affiliate_task(
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

  if exists (select 1 from public.affiliate_task_completions where task_id = p_task_id) then
    update public.affiliate_tasks set is_active = false, updated_at = now()
     where id = p_task_id;
    return 'archived';
  end if;

  delete from public.affiliate_tasks where id = p_task_id;
  return 'deleted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants. ⚠️ `create function` re-grants EXECUTE to PUBLIC.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_list_affiliate_prizes(uuid, public.affiliate_game_kind)',
    'public.admin_save_affiliate_prizes(uuid, public.affiliate_game_kind, jsonb)',
    'public.admin_list_affiliate_tasks(uuid)',
    'public.admin_affiliate_task_exposure(uuid, public.affiliate_task_metric, int, uuid)',
    'public.admin_save_affiliate_task(uuid, jsonb)',
    'public.admin_delete_affiliate_task(uuid, uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
