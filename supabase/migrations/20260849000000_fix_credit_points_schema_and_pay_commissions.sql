-- ============================================================================
-- Migration 201 — fix credit_points schema and pay pending referral commissions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.credit_points(
  p_user_id           uuid,
  p_amount            bigint,
  p_entry_type        public.ledger_entry_type,
  p_reference_type    text    default null,
  p_reference_id      text    default null,
  p_metadata          jsonb   default '{}'::jsonb,
  p_enforce_daily_cap boolean default false
)
returns public.points_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today       date := public.utc_today();
  v_tier        public.tiers;
  v_cooldown    int;
  v_counter     public.daily_earning_counters;
  v_existing    public.daily_earning_counters;
  v_points_cap  bigint;
  v_new_balance bigint;
  v_entry       public.points_ledger;
  v_rate        bigint;
  v_disabled    timestamptz;
  v_free_days   int;
  v_joined      timestamptz;
  v_issued      bigint;
  v_alerted     timestamptz;
  v_ceiling     bigint;
  v_pool_now    bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Credit amount must be positive, got %', p_amount using errcode = 'check_violation';
  end if;

  if p_entry_type <> 'admin_adjustment' then
    select p.disabled_at into v_disabled from public.profiles p where p.id = p_user_id;
    if v_disabled is not null then
      raise exception 'Account is disabled and cannot earn' using errcode = 'check_violation';
    end if;
  end if;

  if p_entry_type <> 'redemption_refund'
     and public.config_bool('earning_paused_globally') then
    raise exception 'Earning is paused platform-wide' using errcode = 'check_violation';
  end if;

  /*
    THE FREE WINDOW. Only for somebody on the free plan watching ads — `resolve_user_tier`
    returns the default tier exactly when no plan is live.
    Referral commissions, affiliate commissions, bonuses and adjustments must
    NEVER be blocked by the free ad-watching trial.
  */
  if p_entry_type in ('ad_view', 'survey') then
    v_free_days := public.config_int('free_earning_days')::int;
    if v_free_days > 0 and (public.resolve_user_tier(p_user_id)).is_default then
      select p.created_at into v_joined from public.profiles p where p.id = p_user_id;
      if v_joined is not null and now() > v_joined + make_interval(days => v_free_days) then
        raise exception 'The free plan earns for % days after joining. Buy a plan to keep earning; the points you already have are yours to withdraw.',
          v_free_days using errcode = 'check_violation';
      end if;
    end if;
  end if;

  v_rate := public.config_int('points_per_currency_unit');

  if p_enforce_daily_cap then
    v_ceiling := public.config_int('reward_pool_daily_ceiling_points');
    if v_ceiling > 0 and public.config_bool('reward_pool_ceiling_blocks') then
      select points_issued into v_pool_now
        from public.daily_issuance where day = v_today;
      if coalesce(v_pool_now, 0) >= v_ceiling then
        raise exception 'Reward pool daily ceiling of % points reached', v_ceiling
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if p_enforce_daily_cap then
    v_tier := public.resolve_user_tier(p_user_id);

    if v_tier.daily_ad_cap <= 0 then
      raise exception 'Tier % has a daily cap of zero', v_tier.slug using errcode = 'check_violation';
    end if;

    v_cooldown := coalesce(
      nullif(v_tier.ad_cooldown_seconds, 0),
      public.config_int('ad_cooldown_seconds_default')::int
    );

    insert into public.daily_earning_counters (user_id, day, ads_completed, points_earned, last_earned_at)
    values (p_user_id, v_today, 1, p_amount, now())
    on conflict (user_id, day) do update
      set ads_completed  = public.daily_earning_counters.ads_completed + 1,
          points_earned  = public.daily_earning_counters.points_earned + p_amount,
          last_earned_at = now()
      where public.daily_earning_counters.ads_completed < v_tier.daily_ad_cap
        and (
          v_cooldown <= 0
          or public.daily_earning_counters.last_earned_at is null
          or now() - public.daily_earning_counters.last_earned_at >= make_interval(secs => v_cooldown)
        )
    returning * into v_counter;

    if not found then
      select * into v_existing
        from public.daily_earning_counters
       where user_id = p_user_id and day = v_today;

      if v_existing.ads_completed >= v_tier.daily_ad_cap then
        raise exception 'Daily cap of % reached', v_tier.daily_ad_cap
          using errcode = 'check_violation';
      else
        raise exception 'Cooldown active: % seconds required between ads', v_cooldown
          using errcode = 'check_violation';
      end if;
    end if;

    v_points_cap := public.config_int('per_user_daily_points_cap');
    if v_points_cap > 0 and v_counter.points_earned > v_points_cap then
      raise exception 'Daily points cap of % reached', v_points_cap
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.user_balances (user_id, balance, lifetime_earned, updated_at)
  values (p_user_id, p_amount, p_amount, now())
  on conflict (user_id) do update
    set balance         = public.user_balances.balance + p_amount,
        lifetime_earned = public.user_balances.lifetime_earned + p_amount,
        updated_at      = now()
  returning balance into v_new_balance;

  insert into public.points_ledger (
    user_id, entry_type, amount, balance_after,
    reference_type, reference_id, points_per_currency_unit, metadata
  )
  values (
    p_user_id, p_entry_type, p_amount, v_new_balance,
    p_reference_type, p_reference_id, v_rate, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_entry;

  insert into public.daily_issuance (day, points_issued, updated_at)
  values (v_today, p_amount, now())
  on conflict (day) do update
    set points_issued = public.daily_issuance.points_issued + p_amount,
        updated_at    = now()
  returning points_issued, ceiling_alerted_at into v_issued, v_alerted;

  v_ceiling := public.config_int('reward_pool_daily_ceiling_points');

  if v_ceiling > 0 and v_issued >= v_ceiling then
    update public.daily_issuance
       set ceiling_alerted_at = now()
     where day = v_today and ceiling_alerted_at is null;

    if found then
      insert into public.system_alerts (severity, code, message, context)
      values (
        'critical',
        'reward_pool_ceiling_exceeded',
        format('Daily points issuance (%s) has reached the configured ceiling (%s). Earning %s.',
               v_issued, v_ceiling,
               case when public.config_bool('reward_pool_ceiling_blocks')
                    then 'is now BLOCKED for the rest of the UTC day'
                    else 'was NOT blocked' end),
        jsonb_build_object(
          'day', v_today,
          'issued', v_issued,
          'ceiling', v_ceiling,
          'blocking', public.config_bool('reward_pool_ceiling_blocks')
        )
      );
    end if;
  end if;

  return v_entry;
end;
$$;

revoke execute on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean) from public, anon;
grant execute on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean) to service_role;

-- Retroactively pay commission for William Jones
do $$
declare
  r record;
begin
  for r in
    select id
      from public.subscription_payments
     where status = 'confirmed'
       and created_at >= now() - interval '24 hours'
     order by created_at asc
  loop
    begin
      perform public.pay_referral_purchase_commission(r.id);
    exception when others then
      null;
    end;
  end loop;
end $$;
