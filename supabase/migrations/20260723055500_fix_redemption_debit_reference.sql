-- ============================================================================
-- Migration 019 — Give the redemption debit a real reference
--
-- request_redemption() debited points before creating the redemption row, so
-- it had no id to reference and passed the literal 'pending'. points_ledger
-- has a unique index on (user_id, entry_type, reference_type, reference_id) to
-- stop the same source being credited or debited twice — and with a constant
-- reference, that index made the SECOND redemption request by any user fail
-- forever with a duplicate key error.
--
-- Every user would have been able to cash out exactly once in the platform's
-- lifetime. The first request always worked, which is why nothing caught it
-- until a test made two in a row.
--
-- Fix: create the redemption row first, then debit against its id. Ordering is
-- safe because the whole function is one transaction — if the debit raises for
-- insufficient balance, the redemption row rolls back with it and no orphan
-- remains.
--
-- Side benefit: the idempotency guarantee now does something useful. Each
-- redemption id can be debited exactly once, so a retried request cannot
-- double-charge a user.
-- ============================================================================

create or replace function public.request_redemption(
  p_user_id uuid, p_method public.payout_method, p_points bigint, p_ip inet default null
)
returns public.redemption_request_result
language plpgsql security definer set search_path = '' as $$
declare
  v_tier      public.tiers;
  v_details   public.user_payout_details;
  v_rate      bigint;
  v_hold_h    int;
  v_cooloff_h int;
  v_profile   public.profiles;
  v_risk      public.user_risk_scores;
  v_coin      public.payout_coins;
  v_network   public.payout_coin_networks;
  v_provider  public.payout_providers;
  v_amount    numeric(18,2);
  v_id        uuid;
  v_until     timestamptz;
  v_age_hours numeric;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  if v_profile.disabled_at is not null then
    raise exception 'This account is disabled and cannot request a payout'
      using errcode = 'check_violation';
  end if;

  select * into v_details from public.user_payout_details
   where user_id = p_user_id and method = p_method;
  if not found then
    raise exception 'Add your % details before requesting a payout',
      case p_method when 'crypto' then 'crypto wallet' else 'mobile money' end
      using errcode = 'check_violation';
  end if;

  v_cooloff_h := public.config_int('payout_details_change_cooloff_hours')::int;
  if v_cooloff_h > 0 then
    v_age_hours := extract(epoch from (now() - v_details.last_changed_at)) / 3600.0;
    if v_age_hours < v_cooloff_h then
      raise exception 'Payout details were changed recently. You can request a payout in % hour(s).',
        ceil(v_cooloff_h - v_age_hours) using errcode = 'check_violation';
    end if;
  end if;

  v_tier := public.resolve_user_tier(p_user_id);
  if p_points < v_tier.redemption_minimum_points then
    raise exception 'Minimum payout for the % tier is % points', v_tier.name, v_tier.redemption_minimum_points
      using errcode = 'check_violation';
  end if;

  v_rate   := public.config_int('points_per_currency_unit');
  v_amount := round(p_points::numeric / v_rate, 2);

  if v_amount <= 0 then
    raise exception 'Amount is too small to pay out' using errcode = 'check_violation';
  end if;

  v_hold_h := public.config_int('redemption_holding_hours')::int;
  v_until  := now() + make_interval(hours => v_hold_h);

  select * into v_risk from public.user_risk_scores where user_id = p_user_id;

  if p_method = 'crypto' then
    select * into v_coin    from public.payout_coins          where id = v_details.coin_id;
    select * into v_network from public.payout_coin_networks  where id = v_details.network_id;
  else
    select * into v_provider from public.payout_providers     where id = v_details.provider_id;
  end if;

  -- Create the row FIRST so the debit has a unique reference to point at.
  insert into public.redemptions (
    user_id, status, method,
    points_amount, points_per_currency_unit, currency_amount,
    snapshot_coin_code, snapshot_network_code, snapshot_wallet,
    snapshot_provider_code, snapshot_msisdn, snapshot_account_name,
    holding_until, risk_score_at_request, risk_level_at_request
  )
  values (
    p_user_id, 'held', p_method,
    p_points, v_rate, v_amount,
    v_coin.code, v_network.code, v_details.wallet_address,
    v_provider.code, v_details.msisdn, v_details.account_name,
    v_until, coalesce(v_risk.score, 0), coalesce(v_risk.level, 'low')
  )
  returning id into v_id;

  -- Insufficient balance raises here and rolls the row above back with it.
  perform public.debit_points(
    p_user_id, p_points, 'redemption_request', 'redemption', v_id::text,
    jsonb_build_object('method', p_method, 'currency_amount', v_amount)
  );

  perform public.record_auth_signal(p_user_id, 'redemption_request', p_ip);

  if extract(epoch from (now() - v_profile.created_at)) / 86400.0
     < public.config_int('fraud_rapid_redemption_days')::numeric then
    perform public.record_fraud_signal(p_user_id, 'rapid_redemption_after_signup',
      jsonb_build_object('account_age_days',
        round(extract(epoch from (now() - v_profile.created_at)) / 86400.0, 1)));
  end if;

  return row(v_id, 'held'::public.redemption_status, p_points, v_amount, v_until,
    format('Request received. It will be reviewed after %s hours.', v_hold_h)
  )::public.redemption_request_result;
end;
$$;

revoke execute on function public.request_redemption(uuid, public.payout_method, bigint, inet)
  from public, anon, authenticated;
