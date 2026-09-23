-- ============================================================================
-- Migration 189 — a new member is walked to their first cedi, then asked
--
-- Operator brief, 2026-09-22: a brand new account should be taken through the
-- app in ORDER and not let loose in it. Show them the balance and the
-- statement, make them watch one real ad, congratulate them on the cedi they
-- just earned, and ask for the upgrade THERE, at the top of the feeling.
-- Payout account, PIN, games, community and invites follow. Password and email
-- are deliberately absent: they are chores, not actions worth conditioning.
--
-- WHY THE UPGRADE SITS FOURTH AND NOT LAST. The free plan is one ad a day. The
-- moment the first ad pays is the moment the member has both proof that the
-- money is real AND no second ad to watch today. That is the whole argument,
-- and it is only true for about thirty seconds. Asking at the end of a nine
-- step tour asks a bored person.
--
-- ── A STEP IS DONE WHEN THE THING IS TRUE ──────────────────────────────────
--
-- The obvious build stores "user pressed Next" per step. It is wrong here,
-- because half these steps are money preconditions: a checklist that ticks
-- "payout account" because a tooltip was dismissed tells somebody they can
-- withdraw when they cannot. So every step that corresponds to a FACT is
-- derived from the table that holds that fact, on every read:
--
--   first_ad  user_ad_state.status = 'completed'
--   payout    a row in user_payout_details
--   pin       has_withdrawal_pin()
--   upgrade   a live subscription to a plan that is not the default
--
-- Only the steps that are purely "you have now been shown this" are stored,
-- in `seen_steps`. The consequence is the good one: set the PIN on a laptop
-- and the phone already knows.
--
-- ⚠️ THE AD POOL CAN BE EMPTY. `first_ad` is the one step a member cannot
-- satisfy by trying harder, so the state reports `first_ad_blocked` when
-- nothing is servable and the client offers to move on. A walkthrough that
-- traps somebody on step three is worse than no walkthrough.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The steps, as configuration
-- ---------------------------------------------------------------------------
--
-- A table rather than a constant in the app: the operator asked to be able to
-- drop a step or move one without a release. The KEY is what the code knows;
-- the order and the switch are theirs.

create table if not exists public.onboarding_steps (
  key         text primary key check (key ~ '^[a-z_]{2,40}$'),
  sort_order  integer not null,
  is_enabled  boolean not null default true,

  /* Whether the step is satisfied by a fact in the database or by having been
     shown. Set here rather than inferred so the read below never has to guess,
     and so a new step is explicit about which kind it is. */
  is_derived  boolean not null default false,

  updated_at  timestamptz not null default now()
);

comment on table public.onboarding_steps is
  'The first-run walkthrough, in order. `is_derived` steps are satisfied by real data (a payout account exists, an ad was completed); the rest by having been shown. The operator may reorder and disable, never rename: the key is what the app dispatches on.';

insert into public.onboarding_steps (key, sort_order, is_enabled, is_derived) values
  ('balance',    1, true,  false),
  ('statement',  2, true,  false),
  ('first_ad',   3, true,  true ),
  ('celebrate',  4, true,  false),
  ('upgrade',    5, true,  true ),
  ('payout',     6, true,  true ),
  ('pin',        7, true,  true ),
  ('games',      8, true,  false),
  ('community',  9, true,  false),
  ('invite',    10, true,  false)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. Where a member is up to
-- ---------------------------------------------------------------------------

create table if not exists public.user_onboarding (
  user_id     uuid primary key references auth.users (id) on delete cascade,

  /* The steps that have been SHOWN. Only meaningful for the steps that are not
     derived; a derived step's row here is ignored, so a client that ticks one
     by mistake cannot fake a payout account. */
  seen_steps  text[] not null default '{}',

  started_at    timestamptz not null default now(),
  /* Set when they chose to stop. The walkthrough never runs again on its own
     after this; the checklist on Home stays. Cleared by a replay. */
  skipped_at    timestamptz,
  completed_at  timestamptz,

  updated_at  timestamptz not null default now()
);

comment on table public.user_onboarding is
  'One row per member: which walkthrough steps have been shown, and whether they finished or stopped. The steps that gate money are NOT recorded here, they are read from the tables that own them.';

alter table public.user_onboarding enable row level security;

/* Own row, or an admin looking. Same shape as the other thirteen tables that
   carry `own or is_admin()`; a user-facing query must still filter by user_id
   (an admin reading unfiltered gets everybody's). */
drop policy if exists user_onboarding_select on public.user_onboarding;
create policy user_onboarding_select on public.user_onboarding
  for select using (user_id = (select auth.uid()) or public.is_admin());

alter table public.onboarding_steps enable row level security;

drop policy if exists onboarding_steps_select on public.onboarding_steps;
create policy onboarding_steps_select on public.onboarding_steps
  for select using (true);


-- ---------------------------------------------------------------------------
-- 3. The master switch
-- ---------------------------------------------------------------------------

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('onboarding_enabled', 'true', 'bool', null, null, true,
   'The first-run walkthrough for a new member: the welcome sheet, the guided spotlight and the checklist on Home. Off hides all three immediately for everybody, including members part way through.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 4. The state, derived on every read
-- ---------------------------------------------------------------------------
--
-- One call answers the whole feature: is it on, where are they, what is left,
-- and the two facts the copy needs (what the first ad actually paid, and
-- whether there is an ad to watch at all).

create or replace function public.get_onboarding_state(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := auth.uid();
  v_row       public.user_onboarding;
  v_steps     jsonb := '[]'::jsonb;
  v_step      record;
  v_done      boolean;
  v_current   text;
  v_total     int := 0;
  v_completed int := 0;
  v_first_ad  boolean;
  v_ads_left  int;
  v_earned    bigint;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  /* You, or staff asking about anybody. The same guard the other user-facing
     reads carry, and the reason this takes the subject as an ARGUMENT rather
     than resolving auth.uid() itself: under "view as user" auth.uid() is the
     ADMIN, and a screen rendered from it would show the admin's progress on
     the member's account. */
  if p_user_id <> v_me and not public.is_admin() then
    raise exception 'Not allowed' using errcode = 'check_violation';
  end if;

  if not coalesce(public.config_bool('onboarding_enabled'), false) then
    return jsonb_build_object('enabled', false);
  end if;

  select * into v_row from public.user_onboarding where user_id = p_user_id;

  /* The facts, read once rather than per step. */
  select exists (
    select 1 from public.user_ad_state s
     where s.user_id = p_user_id and s.status = 'completed'
  ) into v_first_ad;

  /* What the first ad actually paid, for the congratulation. Read from the
     ledger rather than recomputed from the tier, because the rate in force is
     written onto the entry and that is the number they saw land. */
  select coalesce(sum(l.amount), 0) into v_earned
    from public.points_ledger l
   where l.user_id = p_user_id
     and l.entry_type in ('ad_view', 'survey');

  /* Is there anything to watch? A member cannot try harder past an empty
     pool, so the client needs to know the difference between "has not yet"
     and "cannot". */
  select count(*)::int into v_ads_left
    from public.get_eligible_ads(p_user_id, 1);

  for v_step in
    select s.key, s.is_derived
      from public.onboarding_steps s
     where s.is_enabled
     order by s.sort_order
  loop
    if v_step.is_derived then
      v_done := case v_step.key
        when 'first_ad' then v_first_ad
        when 'payout'   then exists (
          select 1 from public.user_payout_details d where d.user_id = p_user_id)
        when 'pin'      then public.has_withdrawal_pin(p_user_id)
        when 'upgrade'  then
          /* Bought a plan, OR was shown the offer and declined. Declining is a
             legitimate end to the step: the walkthrough must not hold somebody
             hostage until they pay. */
          exists (
            select 1
              from public.user_subscriptions u
              join public.tiers t on t.id = u.tier_id
             where u.user_id = p_user_id
               and not t.is_default
               and u.status in ('active', 'grace')
               and coalesce(u.grace_ends_at, u.current_period_end) > now()
          ) or ('upgrade' = any(coalesce(v_row.seen_steps, '{}')))
        else false
      end;
    else
      v_done := v_step.key = any(coalesce(v_row.seen_steps, '{}'));
    end if;

    v_total := v_total + 1;
    if v_done then
      v_completed := v_completed + 1;
    elsif v_current is null then
      v_current := v_step.key;
    end if;

    v_steps := v_steps || jsonb_build_object('key', v_step.key, 'done', v_done);
  end loop;

  return jsonb_build_object(
    'enabled',        true,
    'started',        v_row.user_id is not null,
    'skipped',        v_row.skipped_at is not null,
    'completed',      v_current is null,
    'currentStep',    v_current,
    'steps',          v_steps,
    'total',          v_total,
    'doneCount',      v_completed,
    'firstAdDone',    v_first_ad,
    'firstAdBlocked', (not v_first_ad) and v_ads_left = 0,
    'adPoints',       v_earned,
    /* The peg, so the congratulation can say the cedi figure. Read here rather
       than by the client because `points_per_currency_unit` is a private key:
       a user-role select on app_config returns null for it and the sheet would
       silently divide by a default that may not be the live one. */
    'pointsPerCedi',  coalesce(public.config_int('points_per_currency_unit'), 100)
  );
end;
$$;

revoke execute on function public.get_onboarding_state(uuid) from public, anon;
grant  execute on function public.get_onboarding_state(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Marking a step shown, stopping, and replaying
-- ---------------------------------------------------------------------------
--
-- Takes the acting user from `auth.uid()` and NOT from an argument. This is
-- the one function here that writes, and a walkthrough is not worth a hole
-- where one account can advance another's. It is also the correct behaviour
-- under "view as user": an admin looking cannot tick a member's steps, and the
-- middleware refuses the POST anyway.

create or replace function public.mark_onboarding_step(p_step text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  /* An unknown key would sit in the array for ever and never match a step,
     which is harmless but makes the row a lie. Refuse it. */
  if not exists (select 1 from public.onboarding_steps where key = p_step) then
    raise exception 'No such step' using errcode = 'check_violation';
  end if;

  insert into public.user_onboarding (user_id, seen_steps)
  values (v_me, array[p_step])
  on conflict (user_id) do update
    set seen_steps = (
          select array(select distinct unnest(public.user_onboarding.seen_steps || array[p_step]))
        ),
        updated_at = now();

  return public.get_onboarding_state(v_me);
end;
$$;

revoke execute on function public.mark_onboarding_step(text) from public, anon;
grant  execute on function public.mark_onboarding_step(text) to authenticated;


create or replace function public.skip_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  insert into public.user_onboarding (user_id, skipped_at)
  values (v_me, now())
  on conflict (user_id) do update
    set skipped_at = now(), updated_at = now();

  return public.get_onboarding_state(v_me);
end;
$$;

revoke execute on function public.skip_onboarding() from public, anon;
grant  execute on function public.skip_onboarding() to authenticated;


create or replace function public.replay_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'check_violation';
  end if;

  /* Only the SHOWN steps are cleared. A replay must not pretend they have no
     payout account: those steps stay ticked because they are still true, and
     the walkthrough will simply walk past them. */
  insert into public.user_onboarding (user_id, seen_steps, skipped_at, completed_at)
  values (v_me, '{}', null, null)
  on conflict (user_id) do update
    set seen_steps = '{}', skipped_at = null, completed_at = null, updated_at = now();

  return public.get_onboarding_state(v_me);
end;
$$;

revoke execute on function public.replay_onboarding() from public, anon;
grant  execute on function public.replay_onboarding() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. The admin's two controls
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_onboarding_steps(p_admin_id uuid)
returns table (key text, sort_order integer, is_enabled boolean, is_derived boolean)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);
  return query
  select s.key, s.sort_order, s.is_enabled, s.is_derived
    from public.onboarding_steps s
   order by s.sort_order;
end;
$$;

revoke execute on function public.admin_list_onboarding_steps(uuid) from public, anon, authenticated;


create or replace function public.admin_save_onboarding_steps(
  p_admin_id uuid,
  p_steps    jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n   int := 0;
  v_row jsonb;
begin
  perform public.assert_admin(p_admin_id);

  if jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Steps must be a list' using errcode = 'check_violation';
  end if;

  /* The whole list arrives at once and is written in one statement, because a
     reorder that half applied would leave two steps claiming the same
     position and the walkthrough would repeat one. */
  for v_row in select * from jsonb_array_elements(p_steps)
  loop
    update public.onboarding_steps
       set sort_order = (v_row ->> 'sortOrder')::int,
           is_enabled = coalesce((v_row ->> 'isEnabled')::boolean, is_enabled),
           updated_at = now()
     where key = (v_row ->> 'key');

    if found then
      v_n := v_n + 1;
    end if;
  end loop;

  /* `first_ad` off would leave the celebration and the upgrade pitch with
     nothing behind them, which is the whole conversion sequence gone by
     accident. Refuse it rather than quietly shipping a broken funnel. */
  if not exists (
    select 1 from public.onboarding_steps where key = 'first_ad' and is_enabled
  ) and exists (
    select 1 from public.onboarding_steps where key in ('celebrate', 'upgrade') and is_enabled
  ) then
    raise exception 'Turn off the celebration and the upgrade step before the first ad step, or they have nothing to celebrate'
      using errcode = 'check_violation';
  end if;

  return v_n;
end;
$$;

revoke execute on function public.admin_save_onboarding_steps(uuid, jsonb) from public, anon, authenticated;
