-- ============================================================================
-- Migration 081 — referral bonuses are FLAT. Only ad earning uses a multiplier.
--
-- Operator correction, 2026-07-30, and they are right that it is a caveat:
-- all three referral payments were multiplied by the REFERRER's own
-- `tiers.referral_bonus_multiplier`, so the same invited person was worth a
-- different amount depending on who invited them. A Platinum holder earned
-- 2× what a free user earned for bringing in the identical person doing the
-- identical thing.
--
-- THE RULE FROM NOW ON: the reward multiplier applies to AD EARNING and
-- nothing else. Referral bonuses, task rewards, gift codes and game prizes
-- are flat and identical for every user, whatever plan or plans they hold.
-- The last three already were; this fixes the referrals.
--
-- Three call sites, all restated from the LIVE `pg_get_functiondef` rather
-- than from their original migration files — every one of these has been
-- amended since it was written, so the files are not what runs:
--
--   apply_referral_code              signup bonus
--   check_referral_activation        activation bonus
--   pay_referral_purchase_commission commission on a referee's purchase
--
-- WHAT IS DELIBERATELY NOT CHANGED. `tiers.referral_bonus_multiplier` stays
-- as a column. Historical `referral_commissions` rows record the multiplier
-- that was actually applied to them, and dropping the column would make that
-- history unreadable. It is simply no longer consulted when paying. New rows
-- record 1.000, which is the honest value: no multiplier was applied.
--
-- The Upgrade screen's "+X% on referral bonuses" benefit is removed in the
-- same change — it was advertising this behaviour, and a plan card promising
-- something the money path no longer does is worse than no card at all.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Remove a WRONG OVERLOAD created by an earlier attempt at this migration
-- ---------------------------------------------------------------------------
--
-- The first version of this file retyped `apply_referral_code` from a partial
-- read and got the parameter ORDER wrong — (uuid, text, text, inet) instead of
-- the real (uuid, text, inet, text). Postgres therefore created a SECOND
-- function rather than replacing the first, and PostgREST would have had two
-- candidates for the same named arguments.
--
-- Worse, that retyped body had silently dropped three guards the original
-- carries, including "Referral codes can only be applied before you start
-- earning". Sections 1 and 2 below are now produced by editing the LIVE
-- definition rather than by retyping it, which is the project's own rule and
-- exactly what should have happened first time.

drop function if exists public.apply_referral_code(uuid, text, text, inet);


-- ---------------------------------------------------------------------------
-- 1. Signup bonus — flat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referee_id uuid, p_code text, p_ip inet DEFAULT NULL::inet, p_fingerprint text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_referrer public.profiles;
  v_referee  public.profiles;
  v_bonus    bigint;
  v_row      public.referrals;
  v_shared   int;
begin
  select * into v_referee from public.profiles where id = p_referee_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  if v_referee.referred_by is not null then
    raise exception 'A referral code has already been applied to this account'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.points_ledger l
              where l.user_id = p_referee_id and l.entry_type in ('ad_view','survey')) then
    raise exception 'Referral codes can only be applied before you start earning'
      using errcode = 'check_violation';
  end if;

  select * into v_referrer from public.profiles
   where referral_code = upper(trim(p_code));
  if not found then
    raise exception 'That referral code is not valid' using errcode = 'check_violation';
  end if;

  if v_referrer.id = p_referee_id then
    raise exception 'You cannot refer yourself' using errcode = 'check_violation';
  end if;

  if v_referrer.disabled_at is not null then
    raise exception 'That referral code is no longer active' using errcode = 'check_violation';
  end if;

  v_shared := 0;
  if p_fingerprint is not null then
    select count(*) into v_shared from public.user_devices d
     where d.fingerprint = p_fingerprint and d.user_id = v_referrer.id;
  end if;
  if v_shared = 0 and p_ip is not null then
    select count(*) into v_shared from public.auth_signals s
     where s.ip = p_ip and s.user_id = v_referrer.id;
  end if;

  /* FLAT (operator, 2026-07-30). No resolve_user_tier, no multiplier: an
     invited person is worth the same to everybody who invites them. */
  v_bonus := coalesce(public.config_int('referral_signup_bonus_points'), 0)::bigint;

  insert into public.referrals (referrer_id, referee_id, code_used, signup_bonus_points)
  values (v_referrer.id, p_referee_id, upper(trim(p_code)), v_bonus)
  returning * into v_row;

  update public.profiles set referred_by = v_referrer.id where id = p_referee_id;

  if v_bonus > 0 then
    perform public.credit_points(
      v_referrer.id, v_bonus, 'referral_signup', 'referral', v_row.id::text,
      jsonb_build_object('referee_id', p_referee_id, 'flat_rate', true)
    );
    update public.referrals set signup_bonus_paid_at = now() where id = v_row.id
    returning * into v_row;
  end if;

  if v_shared > 0 then
    perform public.record_fraud_signal(p_referee_id, 'self_referral_suspected',
      jsonb_build_object('referrer_id', v_referrer.id,
                         'shared', case when p_fingerprint is not null then 'device' else 'ip' end));
    perform public.record_fraud_signal(v_referrer.id, 'self_referral_suspected',
      jsonb_build_object('referee_id', p_referee_id));
  end if;

  return v_row;
end;
$function$
;

revoke execute on function public.apply_referral_code(uuid, text, inet, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Activation bonus — flat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_referral_activation(p_referee_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ref    public.referrals;
  v_needed int;
  v_done   int;
  v_bonus  bigint;
begin
  select * into v_ref from public.referrals
   where referee_id = p_referee_id and status = 'pending'
   for update;

  if not found then
    return false;
  end if;

  v_needed := public.config_int('referral_activation_ads_required')::int;

  select count(*) into v_done
    from public.points_ledger l
   where l.user_id = p_referee_id
     and l.entry_type in ('ad_view', 'survey');

  if v_done < v_needed then
    return false;
  end if;

  -- FLAT, as with the signup bonus.
  v_bonus := coalesce(public.config_int('referral_activation_bonus_points'), 0)::bigint;

  if v_bonus > 0 then
    perform public.credit_points(
      v_ref.referrer_id, v_bonus, 'referral_activation', 'referral', v_ref.id::text,
      jsonb_build_object('referee_id', p_referee_id, 'ads_completed', v_done,
                         'flat_rate', true)
    );
  end if;

  update public.referrals
     set status = 'activated',
         activation_bonus_points = v_bonus,
         activation_bonus_paid_at = case when v_bonus > 0 then now() end,
         ads_at_activation = v_done,
         updated_at = now()
   where id = v_ref.id;

  return true;
end;
$function$
;

revoke execute on function public.check_referral_activation(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Commission on a referee's purchase
-- ---------------------------------------------------------------------------
--
-- Restated from the live definition with the multiplication removed and
-- nothing else touched. `v_tier` is no longer read for the amount; the
-- `referral_commissions.tier_multiplier` column now records 1.000, which is
-- the multiplier that was actually applied.

CREATE OR REPLACE FUNCTION public.pay_referral_purchase_commission(p_payment_id uuid)
 RETURNS referral_commissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pay      public.subscription_payments;
  v_ref      public.referrals;
  v_referrer public.profiles;
  v_tier     public.tiers;
  v_scope    text;
  v_percent  numeric;
  v_cap      bigint;
  v_paid     bigint;
  v_rate     bigint;
  v_gross    bigint;
  v_points   bigint;
  v_earns    boolean;
  v_row      public.referral_commissions;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;

  -- Only a payment that actually settled earns anything. Called from inside
  -- confirm_subscription_payment, this is already true; called from anywhere
  -- else it is the thing that must be checked first.
  if v_pay.status <> 'confirmed' then
    return null;
  end if;

  v_percent := coalesce(public.config_decimal('referral_purchase_commission_percent'), 0);
  if v_percent <= 0 then
    return null;                                   -- stage switched off
  end if;

  -- A rejected referral earns nothing further. Pending and activated both do:
  -- requiring activation first would mean a referee who buys a plan on day one
  -- and watches four ads never earns their referrer anything, and a farm
  -- cannot profit from buying plans to milk a commission that is capped below
  -- the price of the plan.
  select * into v_ref from public.referrals
   where referee_id = v_pay.user_id and status <> 'rejected'
   for update;
  if not found then
    return null;
  end if;

  -- Belt and braces. The table's own CHECK makes this impossible, but this is
  -- the money path and self-referral is the fraud it would be built for.
  if v_ref.referrer_id = v_ref.referee_id then
    return null;
  end if;

  select * into v_referrer from public.profiles where id = v_ref.referrer_id;
  if not found or v_referrer.disabled_at is not null then
    -- Same refusal `apply_referral_code` makes, made here rather than by
    -- adding this entry type to the guard list inside credit_points — that
    -- function has been amended by five migrations and restating it to edit
    -- one list is the more dangerous change.
    return null;
  end if;

  -- --- Scope -----------------------------------------------------------
  v_scope := coalesce(
    (select value from public.app_config where key = 'referral_purchase_commission_scope'),
    'new_plans'
  );

  if v_scope = 'all' then
    v_earns := true;

  elsif v_scope = 'first' then
    -- Their first purchase of anything.
    v_earns := not exists (
      select 1 from public.subscription_payments p
       where p.user_id = v_pay.user_id
         and p.status = 'confirmed'
         and p.id <> v_pay.id
    );

  else
    -- 'new_plans' — the first time they buy THIS plan. Renewals of a plan they
    -- already bought do not pay again. Because stacking is one-of-each, this
    -- is bounded at one commission per plan per referee for all time.
    v_earns := not exists (
      select 1 from public.subscription_payments p
       where p.user_id = v_pay.user_id
         and p.tier_id = v_pay.tier_id
         and p.status = 'confirmed'
         and p.id <> v_pay.id
    );
  end if;

  if not v_earns then
    return null;
  end if;

  -- --- Amount ----------------------------------------------------------
  -- amount_minor is pesewas; the peg converts cedis to points. Recomputed from
  -- the payment rather than the tier price, so a plan re-priced between
  -- purchase and confirmation cannot pay a commission on money never received.
  v_rate  := public.config_int('points_per_currency_unit');
  v_gross := (v_pay.amount_minor * v_rate) / 100;

  v_tier := public.resolve_user_tier(v_ref.referrer_id);

  -- FLAT: the percentage alone. The referrer's plan no longer changes what a
  -- referee's purchase is worth (operator, 2026-07-30).
  v_points := floor(v_gross * (v_percent / 100.0))::bigint;

  -- THE STRUCTURAL LIMIT. Kept even though the percentage is now capped at 50
  -- by the config row's own bounds and nothing multiplies it: this is the
  -- invariant that a referral never costs more than the purchase it rewards,
  -- and it should not depend on another setting's bounds staying where they
  -- are. It simply no longer has anything to clamp in normal operation.
  v_points := least(v_points, v_gross);

  if v_points <= 0 then
    return null;
  end if;

  -- --- Lifetime cap for this referee ------------------------------------
  v_cap := coalesce(public.config_int('referral_purchase_commission_cap_points'), 0);
  if v_cap > 0 then
    select coalesce(sum(points), 0) into v_paid
      from public.referral_commissions
     where referral_id = v_ref.id and reversed_at is null;

    -- Pay the remainder rather than nothing: a purchase that crosses the
    -- ceiling should pay up to it, not silently pay zero.
    v_points := least(v_points, v_cap - v_paid);
    if v_points <= 0 then
      return null;
    end if;
  end if;

  -- --- Credit ------------------------------------------------------------
  -- reference (subscription_payment, payment id) is load-bearing: it is the
  -- first of the two idempotency guards, via points_ledger_source_once_idx,
  -- which raises 23505 if this same referrer is ever credited for this same
  -- payment twice. The unique payment_id on referral_commissions is the other.
  perform public.credit_points(
    v_ref.referrer_id,
    v_points,
    'referral_purchase',
    'subscription_payment',
    v_pay.id::text,
    jsonb_build_object(
      'referral_id',     v_ref.id,
      'referee_id',      v_ref.referee_id,
      'tier_id',         v_pay.tier_id,
      'amount_minor',    v_pay.amount_minor,
      'percent',         v_percent,
      'flat_rate', true,
      'scope',           v_scope
    )
  );

  insert into public.referral_commissions
    (referral_id, referrer_id, referee_id, payment_id, tier_id,
     amount_minor, currency_code, percent_applied, tier_multiplier,
     scope_at_payment, points)
  values
    (v_ref.id, v_ref.referrer_id, v_ref.referee_id, v_pay.id, v_pay.tier_id,
     v_pay.amount_minor, v_pay.currency_code, v_percent, 1.000,
     v_scope, v_points)
  returning * into v_row;

  perform public.create_notification(
    v_ref.referrer_id,
    'payout',
    'You earned a referral commission',
    'Someone you invited bought a plan. ' || v_points::text || ' points have been added to your balance.',
    jsonb_build_object('referral_commission_id', v_row.id, 'points', v_points)
  );

  return v_row;
end;
$function$
;

revoke execute on function public.pay_referral_purchase_commission(uuid)
  from public, anon, authenticated;
