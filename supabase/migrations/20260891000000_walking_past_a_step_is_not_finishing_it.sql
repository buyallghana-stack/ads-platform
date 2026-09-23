-- ============================================================================
-- Migration 191 — walking past a step is not the same as finishing it
--
-- Found by driving the whole walkthrough on the real app and photographing
-- every step (`scripts/walk-onboarding.mjs`). Two faults, one cause.
--
-- 1. ⚠️ THE CONGRATULATION NEVER APPEARED. Migration 190 made `celebrate`
--    derived from the first ad so the checklist would stop asking a member to
--    "collect your first points" they already had. It fixed the lie and
--    destroyed the moment: the instant the ad completed the step counted as
--    done, so the walkthrough stepped straight over the GHS 1.00 screen to the
--    payout form. The best screen in the product had become unreachable.
--
-- 2. THE ONLY WAY PAST THE PAYOUT STEP WAS TO END THE WALKTHROUGH. `payout`
--    and `pin` are satisfied by real rows, so pressing anything short of
--    actually filling the form left the member where they were. The bar
--    offered Skip, and Skip stops everything. "Not right now" is an ordinary
--    thing to want, and it should not cost the remaining five steps.
--
-- ── THE CAUSE: ONE FLAG ANSWERING TWO QUESTIONS ────────────────────────────
--
-- "Has this member finished this?" and "has the walkthrough gone past this?"
-- are different questions, and they were the same boolean.
--
--   satisfied  the thing is TRUE. A payout account exists, an ad was watched.
--              This is what the checklist ticks, and it is the one that must
--              never be faked, because it is what tells somebody they can be
--              paid.
--   walked     the walkthrough has shown it and moved on. Either they did the
--              thing, or they were shown it and said not now.
--
-- `walked` drives the pointer. `satisfied` drives the checklist. A member can
-- therefore walk the whole tour in a minute and still be told, honestly and
-- for as long as it stays true, that they have no payout account.
-- ============================================================================


-- `celebrate` is a MOMENT, not a task: it goes back to being shown rather than
-- derived, so it displays once. The checklist simply does not list it, because
-- watching the first ad IS collecting the first points and there is no second
-- thing to do.
update public.onboarding_steps
   set is_derived = false, updated_at = now()
 where key = 'celebrate';


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
  v_seen      boolean;
  v_fact      boolean;
  v_satisfied boolean;
  v_walked    boolean;
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
    v_seen := v_step.key = any(coalesce(v_row.seen_steps, '{}'));

    if v_step.is_derived then
      v_fact := case v_step.key
        when 'first_ad' then v_first_ad
        when 'payout'   then exists (
          select 1 from public.user_payout_details d where d.user_id = p_user_id)
        when 'pin'      then public.has_withdrawal_pin(p_user_id)
        when 'upgrade'  then exists (
          select 1
            from public.user_subscriptions u
            join public.tiers t on t.id = u.tier_id
           where u.user_id = p_user_id
             and not t.is_default
             and u.status in ('active', 'grace')
             and coalesce(u.grace_ends_at, u.current_period_end) > now()
        )
        else false
      end;

      /*
        THE THING IS TRUE, or it is not. Being shown it changes nothing.

        `upgrade` is the one exception, and it is not a fudge: that row reads
        "Look at the plans", and looking at them IS the task. Buying one is a
        bonus, not the requirement. Every other derived step describes
        something that must exist before money can move, and for those, being
        shown the screen means nothing at all.
      */
      v_satisfied := case when v_step.key = 'upgrade' then v_fact or v_seen else v_fact end;
      /* The walkthrough moves on either when they did it or when they were
         offered it and said not now. */
      v_walked := v_fact or v_seen;
    else
      v_satisfied := v_seen;
      v_walked := v_seen;
    end if;

    v_total := v_total + 1;
    if v_satisfied then
      v_completed := v_completed + 1;
    end if;

    if not v_walked and v_current is null then
      v_current := v_step.key;
    end if;

    v_steps := v_steps || jsonb_build_object(
      'key', v_step.key,
      'done', v_satisfied,
      /* The client needs this to tell "ticked" from "stepped past": the
         checklist shows a walked-but-unsatisfied step as still to do. */
      'walked', v_walked
    );
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
