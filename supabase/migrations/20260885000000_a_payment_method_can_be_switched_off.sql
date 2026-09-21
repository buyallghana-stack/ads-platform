-- ============================================================================
-- Migration 237 — a payment method can be switched off
--
-- The operator does not accept crypto today and may not accept mobile money
-- on a day Korapay is down. Until now the only way to say so was to
-- deactivate every coin one at a time, which is not the same statement: an
-- empty coin list leaves the crypto card sitting on the payout screen with a
-- picker that offers nothing, and `request_redemption` never read `is_active`
-- at all, so a destination saved while a coin was live stayed spendable after
-- it was switched off.
--
-- So a METHOD is now a switch of its own, and the switch is `app_config`,
-- which is the admin screen this platform already has for anything that
-- decides where money goes.
--
-- ⚠️ ONE IMPLEMENTATION, TWO CALLERS
-- `payout_method_enabled` exists so that "is crypto on?" is answered in
-- exactly one place. The two functions that must ask are the one that saves a
-- destination and the one that spends it, and this repository has already
-- been bitten by the same rule living in two bodies that drifted apart (the
-- feed and the watch disagreeing about repeats, migration 222). Screens read
-- the same keys through one server helper for the same reason.
--
-- WHAT A SWITCHED-OFF METHOD DOES NOT DO
-- It does not touch redemptions already in the queue. Somebody who requested
-- a crypto payout before the switch is owed that money on that rail, and the
-- admin queue must still be able to pay them. Only NEW destinations and NEW
-- requests are refused.
--
-- THE CHECKOUT KEYS ARE LABELS, NOT GATES, AND ARE NAMED SO
-- `checkout_lists_*` control what the upgrade screen TELLS a buyer to expect.
-- This app has no Paystack call in it — payments go through the Tech Store
-- hub and Paystack's own page decides which channels it accepts — so turning
-- one off changes what we advertise, not what the hub will take. A key called
-- `checkout_card_enabled` would have been a lie about money.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The switches
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, description, is_public) values
  ('payout_method_mobile_money_enabled', 'true', 'bool',
   'Whether users may save a Mobile Money payout account and withdraw to it. Off refuses new destinations and new requests; payouts already in the queue are unaffected.',
   false),

  -- FALSE on purpose. The operator does not accept crypto at launch, and a
  -- switch that ships on is a switch nobody remembers to turn off.
  ('payout_method_crypto_enabled', 'false', 'bool',
   'Whether users may save a crypto wallet and withdraw to it. Off refuses new destinations and new requests; payouts already in the queue are unaffected.',
   false),

  ('checkout_lists_mobile_money', 'true', 'bool',
   'Whether the upgrade checkout lists Mobile Money as a way to pay. A label only: the payment page belongs to the hub, and this does not stop Paystack accepting one.',
   false),

  ('checkout_lists_card', 'true', 'bool',
   'Whether the upgrade checkout lists card or bank as a way to pay. A label only: the payment page belongs to the hub, and this does not stop Paystack accepting one.',
   false)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The one place the question is answered
-- ---------------------------------------------------------------------------

create or replace function public.payout_method_enabled(p_method public.payout_method)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  -- The key is derived from the enum rather than branched on, so adding a
  -- third payout method means adding a row, not editing this function.
  return public.config_bool('payout_method_' || p_method::text || '_enabled');
exception
  -- `config_bool` raises on a missing key. A method with no switch row is a
  -- method nobody has decided about, and the safe reading of that is "off" —
  -- the alternative is money leaving by a rail the operator never approved.
  when no_data_found then
    return false;
end;
$$;

comment on function public.payout_method_enabled(public.payout_method) is
  'Whether a payout method is open for new destinations and new requests. The single implementation: set_payout_details and request_redemption both ask this, and the screens read the same keys.';

revoke execute on function public.payout_method_enabled(public.payout_method) from public, anon;
grant execute on function public.payout_method_enabled(public.payout_method) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. set_payout_details — refuse a destination on a closed rail
-- ---------------------------------------------------------------------------
--
-- Reproduced in full from migration 017 with one guard added at the top.
-- Everything below it is unchanged.

create or replace function public.set_payout_details(
  p_user_id        uuid,
  p_method         public.payout_method,
  p_coin_id        uuid default null,
  p_network_id     uuid default null,
  p_wallet_address text default null,
  p_provider_id    uuid default null,
  p_msisdn         text default null,
  p_account_name   text default null,
  p_ip             inet default null
)
returns public.user_payout_details
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coin     public.payout_coins;
  v_network  public.payout_coin_networks;
  v_provider public.payout_providers;
  v_pattern  text;
  v_old      public.user_payout_details;
  v_new      public.user_payout_details;
  v_old_mask text;
  v_new_mask text;
begin
  -- THE SWITCH. Before any validation, because the answer does not depend on
  -- what they typed.
  if not public.payout_method_enabled(p_method) then
    raise exception '% payouts are not available at the moment',
      case p_method when 'crypto' then 'Crypto' else 'Mobile Money' end
      using errcode = 'check_violation';
  end if;

  select * into v_old from public.user_payout_details
   where user_id = p_user_id and method = p_method;

  if p_method = 'crypto' then
    select * into v_coin from public.payout_coins where id = p_coin_id;
    if not found or not v_coin.is_active then
      raise exception 'Selected coin is not available' using errcode = 'check_violation';
    end if;

    -- Network requirement is read from the coin, never inferred (§6.4.1).
    if v_coin.requires_network then
      if p_network_id is null then
        raise exception 'A network must be selected for %', v_coin.code using errcode = 'check_violation';
      end if;
      select * into v_network from public.payout_coin_networks
       where id = p_network_id and coin_id = p_coin_id;
      if not found or not v_network.is_active then
        raise exception 'Selected network is not available for %', v_coin.code using errcode = 'check_violation';
      end if;
      v_pattern := v_network.address_pattern;
    else
      if p_network_id is not null then
        raise exception '% does not take a network', v_coin.code using errcode = 'check_violation';
      end if;
      v_pattern := v_coin.address_pattern;
    end if;

    if p_wallet_address is null or trim(p_wallet_address) = '' then
      raise exception 'Wallet address is required' using errcode = 'check_violation';
    end if;

    if v_pattern is not null and trim(p_wallet_address) !~ v_pattern then
      raise exception 'Wallet address does not look like a valid % address',
        coalesce(v_network.code, v_coin.code) using errcode = 'check_violation';
    end if;

    v_old_mask := public.mask_payout_value(v_old.wallet_address);
    v_new_mask := public.mask_payout_value(trim(p_wallet_address));

    insert into public.user_payout_details (user_id, method, coin_id, network_id, wallet_address, last_changed_at)
    values (p_user_id, p_method, p_coin_id, p_network_id, trim(p_wallet_address), now())
    on conflict (user_id, method) do update
      set coin_id = excluded.coin_id,
          network_id = excluded.network_id,
          wallet_address = excluded.wallet_address,
          last_changed_at = now(),
          updated_at = now()
    returning * into v_new;

  else
    select * into v_provider from public.payout_providers where id = p_provider_id;
    if not found or not v_provider.is_active then
      raise exception 'Selected mobile money provider is not available' using errcode = 'check_violation';
    end if;

    if p_msisdn is null or trim(p_msisdn) = '' then
      raise exception 'Mobile money number is required' using errcode = 'check_violation';
    end if;

    if replace(trim(p_msisdn), ' ', '') !~ v_provider.number_pattern then
      raise exception 'That number does not look like a valid % number', v_provider.name
        using errcode = 'check_violation';
    end if;

    if p_account_name is null or length(trim(p_account_name)) < 2 then
      raise exception 'The name registered on the mobile money account is required'
        using errcode = 'check_violation';
    end if;

    v_old_mask := public.mask_payout_value(v_old.msisdn);
    v_new_mask := public.mask_payout_value(replace(trim(p_msisdn), ' ', ''));

    insert into public.user_payout_details (user_id, method, provider_id, msisdn, account_name, last_changed_at)
    values (p_user_id, p_method, p_provider_id, replace(trim(p_msisdn), ' ', ''), trim(p_account_name), now())
    on conflict (user_id, method) do update
      set provider_id = excluded.provider_id,
          msisdn = excluded.msisdn,
          account_name = excluded.account_name,
          last_changed_at = now(),
          updated_at = now()
    returning * into v_new;
  end if;

  -- Only record a change when something actually changed. Re-saving the same
  -- details should not trip a fraud signal or restart the cool-off.
  if v_old.user_id is null or v_old_mask is distinct from v_new_mask then
    insert into public.payout_detail_changes (user_id, method, old_masked, new_masked, ip)
    values (p_user_id, p_method, v_old_mask, v_new_mask, p_ip);

    -- First-time setup is not suspicious; changing an existing destination is.
    if v_old.user_id is not null then
      perform public.record_fraud_signal(p_user_id, 'payout_details_changed_recently',
        jsonb_build_object('method', p_method, 'from', v_old_mask, 'to', v_new_mask));
    end if;
  end if;

  return v_new;
end;
$$;

-- ⚠️ A replace re-grants EXECUTE to PUBLIC. This writes where somebody's money
-- goes; it is reached through a server action that names the user from the
-- verified session, never from a browser.
revoke execute on function public.set_payout_details(uuid, public.payout_method, uuid, uuid, text, uuid, text, text, inet)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. request_redemption — refuse a withdrawal on a closed rail
-- ---------------------------------------------------------------------------
--
-- Reproduced in full from migration 145 with one guard added. Everything else
-- is unchanged.

CREATE OR REPLACE FUNCTION public.request_redemption(p_user_id uuid, p_method payout_method, p_points bigint, p_ip inet DEFAULT NULL::inet)
 RETURNS redemption_request_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
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
  v_minimum   bigint;
  v_fee_pct   numeric(5,2);
  v_fee       numeric(18,2);
  v_net       numeric(18,2);
  v_id        uuid;
  v_until     timestamptz;
  v_age_hours numeric;
  v_quote     jsonb;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  if v_profile.disabled_at is not null then
    raise exception 'This account is disabled and cannot request a payout'
      using errcode = 'check_violation';
  end if;

  -- THE SWITCH. Before the details are even looked up: a destination saved
  -- while the rail was open must not outlive the decision to close it.
  if not public.payout_method_enabled(p_method) then
    raise exception '% withdrawals are not available at the moment',
      case p_method when 'crypto' then 'Crypto' else 'Mobile Money' end
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

  -- One minimum, for everybody. No plan has its own any more.
  v_minimum := public.config_int('redemption_minimum_points');
  if p_points < v_minimum then
    raise exception 'The smallest withdrawal is % points', v_minimum
      using errcode = 'check_violation';
  end if;

  v_rate   := public.config_int('points_per_currency_unit');
  v_amount := round(p_points::numeric / v_rate, 2);

  if v_amount <= 0 then
    raise exception 'Amount is too small to pay out' using errcode = 'check_violation';
  end if;

  v_fee_pct := coalesce(public.config_decimal('redemption_fee_percent'), 0);
  v_fee     := round(v_amount * v_fee_pct / 100.0, 2);
  v_net     := v_amount - v_fee;

  if v_net <= 0 then
    raise exception 'The fee would take the whole payout. Withdraw a larger amount.'
      using errcode = 'check_violation';
  end if;

  v_hold_h := public.config_int('redemption_holding_hours')::int;
  v_until  := now() + make_interval(hours => v_hold_h);

  select * into v_risk from public.user_risk_scores where user_id = p_user_id;

  if p_method = 'crypto' then
    select * into v_coin    from public.payout_coins          where id = v_details.coin_id;
    select * into v_network from public.payout_coin_networks  where id = v_details.network_id;

    -- Quoted on the NET: this is the number that gets sent.
    v_quote := public.quote_crypto_payout(v_net, v_coin.code);
  else
    select * into v_provider from public.payout_providers     where id = v_details.provider_id;
  end if;

  insert into public.redemptions (
    user_id, status, method,
    points_amount, points_per_currency_unit, currency_amount,
    fee_percent, fee_amount, net_amount,
    coin_amount, coin_usd, usd_ghs, quoted_at,
    snapshot_coin_code, snapshot_network_code, snapshot_wallet,
    snapshot_provider_code, snapshot_msisdn, snapshot_account_name,
    holding_until, risk_score_at_request, risk_level_at_request
  )
  values (
    p_user_id, 'held', p_method,
    p_points, v_rate, v_amount,
    v_fee_pct, v_fee, v_net,
    (v_quote ->> 'coin_amount')::numeric,
    (v_quote ->> 'coin_usd')::numeric,
    (v_quote ->> 'usd_ghs')::numeric,
    (v_quote ->> 'quoted_at')::timestamptz,
    v_coin.code, v_network.code, v_details.wallet_address,
    v_provider.code, v_details.msisdn, v_details.account_name,
    v_until, coalesce(v_risk.score, 0), coalesce(v_risk.level, 'low')
  )
  returning id into v_id;

  perform public.debit_points(
    p_user_id, p_points, 'redemption_request', 'redemption', v_id::text,
    jsonb_build_object('method', p_method, 'currency_amount', v_amount,
                       'fee_percent', v_fee_pct, 'fee_amount', v_fee,
                       'net_amount', v_net,
                       'coin_amount', v_quote ->> 'coin_amount',
                       'coin', v_coin.code)
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
$function$;

-- ⚠️ Same reason as above: a replace re-grants to PUBLIC, and this one takes
-- points out of a balance.
revoke execute on function public.request_redemption(uuid, public.payout_method, bigint, inet)
  from public, anon, authenticated;
