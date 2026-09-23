-- ============================================================================
-- Migration 190 — the plans come last, and a first ad IS your first points
--
-- Two corrections to the walkthrough, both from the operator watching a real
-- account go through it.
--
-- 1. THE OFFER MOVES TO THE END. It sat fourth, immediately behind the
--    congratulation, on the argument that the moment of the first cedi is the
--    moment of most willingness. The operator's call is that the plans are
--    shown once somebody has seen the whole product. That is a judgement about
--    their own members and it is theirs to make, so `upgrade` becomes step
--    ten and everything between shuffles up.
--
-- 2. ⚠️ `celebrate` WAS A LIE ON THE CHECKLIST. It was a "has been shown"
--    step, so an account that watched an ad and then skipped the walkthrough
--    was still being told to "collect your first points" — with the points
--    already in their balance. Reported on a real account (dereick) that had
--    done exactly that.
--
--    The congratulation is a MOMENT, not a task. There is no separate thing to
--    do: watching the first ad IS collecting the first points. So it becomes
--    derived from the same fact as `first_ad`, and the checklist can no longer
--    ask for something that has already happened.
--
--    The general rule this breaks, and the one to remember: a step may only be
--    "has been shown" if a member who never sees it genuinely has not done it.
--    Anything that describes an OUTCOME has to read the outcome.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The new order
-- ---------------------------------------------------------------------------
--
-- Written as one statement rather than ten, because two steps briefly sharing
-- a sort_order is a walkthrough that shows one of them twice to anybody
-- loading a page in that window.

update public.onboarding_steps s
   set sort_order = v.sort_order,
       updated_at = now()
  from (values
    ('balance',    1),
    ('statement',  2),
    ('first_ad',   3),
    ('celebrate',  4),
    ('payout',     5),
    ('pin',        6),
    ('games',      7),
    ('community',  8),
    ('invite',     9),
    ('upgrade',   10)
  ) as v(key, sort_order)
 where s.key = v.key;


-- ---------------------------------------------------------------------------
-- 2. The congratulation is derived now
-- ---------------------------------------------------------------------------

update public.onboarding_steps
   set is_derived = true, updated_at = now()
 where key = 'celebrate';


-- ---------------------------------------------------------------------------
-- 3. The read, with `celebrate` answered by the ledger rather than by a click
-- ---------------------------------------------------------------------------

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

  if p_user_id <> v_me and not public.is_admin() then
    raise exception 'Not allowed' using errcode = 'check_violation';
  end if;

  if not coalesce(public.config_bool('onboarding_enabled'), false) then
    return jsonb_build_object('enabled', false);
  end if;

  select * into v_row from public.user_onboarding where user_id = p_user_id;

  select exists (
    select 1 from public.user_ad_state s
     where s.user_id = p_user_id and s.status = 'completed'
  ) into v_first_ad;

  select coalesce(sum(l.amount), 0) into v_earned
    from public.points_ledger l
   where l.user_id = p_user_id
     and l.entry_type in ('ad_view', 'survey');

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
        /* THE SAME FACT. There is no second thing to do after watching an ad:
           the points are already in the balance, and asking for them again is
           how a checklist starts lying to somebody. */
        when 'celebrate' then v_first_ad
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
    'pointsPerCedi',  coalesce(public.config_int('points_per_currency_unit'), 100)
  );
end;
$$;

revoke execute on function public.get_onboarding_state(uuid) from public, anon;
grant  execute on function public.get_onboarding_state(uuid) to authenticated;
