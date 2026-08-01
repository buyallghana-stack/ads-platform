-- ============================================================================
-- Migration 095 — three operator decisions about money, 2026-08-01
--
--   1. THE FREE PLAN EARNS FOR 21 DAYS. "Bot farming can really hurt my
--      business even with all these systems designed to combat it, people may
--      have several alternatives." Every other defence here raises the cost of
--      farming; this one caps the PRIZE. A farmed account is worth at most 21
--      days of a free account's daily limit, forever, no matter how many are
--      created. Points already earned stay theirs and stay withdrawable — the
--      window closes earning, it does not confiscate anything.
--
--   2. ONE WITHDRAWAL MINIMUM FOR EVERY ACCOUNT. "No plan should have its own
--      withdrawal threshold." It was a per-plan column, so a Platinum holder
--      could cash out at 1,000 points and a free user needed 5,000. Now a
--      single config key answers for everybody.
--
--   3. A WITHDRAWAL FEE, IN PERCENT, SET BY THE ADMIN — "because of transaction
--      costs and taxes". Frozen on the redemption at request time, so changing
--      the rate later never rewrites what somebody was already promised.
--
-- ALL THREE SHIP AS CONFIG, so none of them needs a deploy to change, and the
-- fee ships at ZERO: turning it on is an operator decision about real costs,
-- not something a migration should do to people's money on its way past.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The keys
-- ---------------------------------------------------------------------------

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description)
values
  ('free_earning_days', '21', 'int', 0, 3650, true,
   'How many days after signing up a FREE account can earn. Buying any plan lifts it for as long as that plan is live. 0 means no limit. This is the cap on what farming an account can ever be worth: points already earned are unaffected and stay withdrawable.'),

  ('redemption_minimum_points', '5000', 'int', 0, 100000000, true,
   'The fewest points anyone may withdraw, whatever plan they hold. Replaces the per-plan threshold — operator decision 2026-08-01, no plan has its own any more.'),

  ('redemption_fee_percent', '0', 'decimal', 0, 100, true,
   'Percentage taken off a withdrawal to cover transaction costs and taxes. Frozen onto each request when it is filed, so raising or lowering it never changes an amount somebody has already been quoted. 0 = no fee.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The free window, enforced where points are created
-- ---------------------------------------------------------------------------
--
-- In `credit_points` rather than in each of the six things that call it,
-- because that is the one door every point comes through — and a rule about
-- who may earn that lives anywhere else is a rule with a way around it.
--
-- WHAT IS EXEMPT, AND WHY. `admin_adjustment` (an operator correcting
-- something by hand), `redemption_refund` (returning points the platform took
-- and did not pay out — refusing that would be keeping somebody's money), and
-- `gift_code` (handed out deliberately, one at a time, by a person). Everything
-- a farm can do at scale — ads, surveys, tasks, games, every referral stage —
-- stops.
--
-- Regenerated from the live definition; the only change is the block below.

CREATE OR REPLACE FUNCTION public.credit_points(p_user_id uuid, p_amount bigint, p_entry_type ledger_entry_type, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_enforce_daily_cap boolean DEFAULT false)
 RETURNS points_ledger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tier        public.tiers;
  v_rate        bigint;
  v_today       date := public.utc_today();
  v_new_balance bigint;
  v_ceiling     bigint;
  v_issued      bigint;
  v_alerted     timestamptz;
  v_cooldown    int;
  v_disabled    timestamptz;
  v_counter     public.daily_earning_counters;
  v_existing    public.daily_earning_counters;
  v_entry       public.points_ledger;
  v_points_cap  bigint;
  v_pool_now    bigint;
  v_free_days   int;
  v_joined      timestamptz;
begin
  if p_amount <= 0 then
    raise exception 'credit_points requires a positive amount, got %', p_amount;
  end if;

  if p_entry_type in ('ad_view', 'survey', 'referral_signup', 'referral_activation') then
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
    THE FREE WINDOW. Only for somebody on the free plan — `resolve_user_tier`
    returns the default tier exactly when no plan is live, and any live plan
    (or its grace period) lifts this immediately, which is the whole offer.
  */
  if p_entry_type not in ('admin_adjustment', 'redemption_refund', 'gift_code') then
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
$function$;

revoke execute on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. One minimum, wherever the number is read
-- ---------------------------------------------------------------------------
--
-- `resolve_user_tier` is what every SCREEN reads, and `request_redemption` is
-- what actually refuses. Both now answer from the config, so the screen and
-- the refusal can never disagree — which they would the moment one of them was
-- changed and the other forgotten. The per-plan column still exists and still
-- holds its old values, because deleting a column deletes the history of what
-- plans used to promise; nothing reads it any more.

CREATE OR REPLACE FUNCTION public.resolve_user_tier(p_user_id uuid)
 RETURNS tiers
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_default   public.tiers;
  v_result    public.tiers;
  v_held      int;
  v_stacking  boolean;
  v_mode      text;
  v_max_mult  numeric;
  v_max_plans int;
  v_cap       int;
  v_mult      numeric;
  v_ref       numeric;
  v_priority  int;
  v_cooldown  int;
  v_min       bigint := public.config_int('redemption_minimum_points');
begin
  select t.* into v_default from public.tiers t where t.is_default limit 1;

  select coalesce((select value::boolean from public.app_config where key = 'subscription_stacking_enabled'), true),
         coalesce((select value from public.app_config where key = 'subscription_multiplier_combine_mode'), 'sum_bonus'),
         coalesce((select value::numeric from public.app_config where key = 'subscription_max_combined_multiplier'), 3.000),
         coalesce((select value::int from public.app_config where key = 'subscription_max_stacked_plans'), 4)
    into v_stacking, v_mode, v_max_mult, v_max_plans;

  select l.* into v_result
    from public.user_subscriptions s
    join public.tiers l on l.id = s.tier_id
   where s.user_id = p_user_id
     and (
       (s.status = 'active' and now() < s.current_period_end)
       or
       (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
     )
   order by l.sort_order desc
   limit 1;

  -- The platform-wide minimum, applied to every answer this function gives —
  -- including the free one, which is why it is set before the early returns.
  v_default.redemption_minimum_points := v_min;

  if v_result.id is null then
    return v_default;
  end if;

  v_result.redemption_minimum_points := v_min;

  if not v_stacking then
    return v_result;
  end if;

  with live as (
    select t.*
      from public.user_subscriptions s
      join public.tiers t on t.id = s.tier_id
     where s.user_id = p_user_id
       and (
         (s.status = 'active' and now() < s.current_period_end)
         or
         (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
       )
     order by t.sort_order desc
     limit greatest(v_max_plans, 1)
  )
  select count(*),
         v_default.daily_ad_cap + sum(greatest(daily_ad_cap - v_default.daily_ad_cap, 0)),
         max(ad_priority),
         min(ad_cooldown_seconds),
         case
           when v_mode = 'sum_bonus' then 1 + sum(reward_multiplier - 1)
           when v_mode = 'sum'       then sum(reward_multiplier)
           when v_mode = 'product'   then exp(sum(ln(reward_multiplier)))
           else max(reward_multiplier)
         end,
         case
           when v_mode = 'highest' then max(referral_bonus_multiplier)
           else 1 + sum(referral_bonus_multiplier - 1)
         end
    into v_held, v_cap, v_priority, v_cooldown, v_mult, v_ref
    from live;

  v_mult := least(greatest(coalesce(v_mult, 1.000), v_default.reward_multiplier), v_max_mult);
  v_ref  := least(greatest(coalesce(v_ref, 1.000), v_default.referral_bonus_multiplier), v_max_mult);

  v_result.slug                      := 'combined';
  v_result.name                      := case when v_held > 1 then v_result.name || ' +' || (v_held - 1) else v_result.name end;
  v_result.daily_ad_cap              := coalesce(v_cap, v_default.daily_ad_cap);
  v_result.reward_multiplier         := v_mult;
  v_result.referral_bonus_multiplier := v_ref;
  v_result.redemption_minimum_points := v_min;
  v_result.ad_priority               := coalesce(v_priority, 0);
  v_result.ad_cooldown_seconds       := coalesce(v_cooldown, 0);
  v_result.is_default                := false;

  return v_result;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 4. What a withdrawal costs, frozen onto the request
-- ---------------------------------------------------------------------------

alter table public.redemptions
  add column if not exists fee_percent numeric(5,2) not null default 0
    check (fee_percent >= 0 and fee_percent <= 100),
  add column if not exists fee_amount numeric(18,2) not null default 0
    check (fee_amount >= 0),
  add column if not exists net_amount numeric(18,2);

comment on column public.redemptions.fee_percent is
  'The fee rate in force when this request was filed. Frozen: changing redemption_fee_percent later must not rewrite what somebody was quoted.';
comment on column public.redemptions.fee_amount is
  'currency_amount x fee_percent, in cedis.';
comment on column public.redemptions.net_amount is
  'What the user actually receives, and what the operator sends. Null on rows filed before fees existed, which is exactly the same thing as a zero fee.';

-- Every row that predates fees was paid in full, and net_amount says so
-- rather than sitting null and making every reader decide what null means.
update public.redemptions set net_amount = currency_amount where net_amount is null;


-- ---------------------------------------------------------------------------
-- 5. Requesting a payout: one minimum, and the fee taken off the top
-- ---------------------------------------------------------------------------
--
-- THE FEE IS A CUT OF THE MONEY, NOT OF THE POINTS. The user redeems the
-- points they asked for and the balance falls by exactly that; the percentage
-- comes off the cedis on the way out, which is where the cost it is paying for
-- (a mobile-money transfer, a chain fee, tax) actually lands. That also keeps
-- the ledger honest: the ledger records points, and no point was taken.
--
-- ON CRYPTO, THE QUOTE IS TAKEN ON THE NET. The coin amount frozen here is
-- what the operator will send, so quoting the gross would promise coin the
-- user is not owed. See the crypto denomination rule: the coin figure is what
-- a human is shown, and it must be the figure that arrives.
--
-- `redemption_request_result` still carries the GROSS in currency_amount, and
-- deliberately: that type is what several callers already read, and quietly
-- changing what one of its fields means is worse than the screen doing one
-- subtraction it can already do. The row carries the frozen truth.

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

revoke execute on function public.request_redemption(uuid, public.payout_method, bigint, inet)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. The screens have to know BEFORE somebody watches an ad
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated because the return type gains two columns. Both are
-- computed here rather than in the app for the reason the points cap already
-- was: `app_config`'s select policy is `is_public OR is_admin()`, so a user
-- client reading a private key gets NULL silently and looks correct to whoever
-- tests it as an admin. This function is SECURITY DEFINER and already
-- authorisation-checked, which is exactly why it is the right place.
--
-- `free_earning_ends_at` is null for anyone the window does not apply to — a
-- plan holder, or a platform with the limit switched off — so "null" means
-- "no deadline" rather than "unknown".

drop function if exists public.get_user_earning_status(uuid);

CREATE OR REPLACE FUNCTION public.get_user_earning_status(p_user_id uuid)
 RETURNS TABLE(balance bigint, tier_slug text, tier_name text, daily_ad_cap integer, ads_completed_today integer, ads_remaining_today integer, currency_value numeric, earning_paused boolean, account_disabled boolean, points_earned_today bigint, points_cap_reached boolean, free_earning_ends_at timestamp with time zone, free_earning_over boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_cap    bigint := public.config_int('per_user_daily_points_cap');
  v_days   int    := public.config_int('free_earning_days')::int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s earning status'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    coalesce(b.balance, 0),
    t.slug,
    t.name,
    t.daily_ad_cap,
    coalesce(c.ads_completed, 0),
    greatest(t.daily_ad_cap - coalesce(c.ads_completed, 0), 0),
    round(coalesce(b.balance, 0)::numeric
          / nullif(public.config_int('points_per_currency_unit'), 0), 2),
    public.config_bool('earning_paused_globally'),
    (select p.disabled_at is not null from public.profiles p where p.id = p_user_id),
    coalesce(c.points_earned, 0)::bigint,
    (v_cap > 0 and coalesce(c.points_earned, 0) >= v_cap),
    case
      when v_days > 0 and t.is_default
        then (select p.created_at + make_interval(days => v_days)
                from public.profiles p where p.id = p_user_id)
    end,
    coalesce(
      case
        when v_days > 0 and t.is_default
          then (select now() > p.created_at + make_interval(days => v_days)
                  from public.profiles p where p.id = p_user_id)
      end,
      false)
  from (select public.resolve_user_tier(p_user_id) as tier) r
  cross join lateral (select (r.tier).*) t
  left join public.user_balances b on b.user_id = p_user_id
  left join public.daily_earning_counters c
    on c.user_id = p_user_id and c.day = public.utc_today();
end;
$function$;

revoke execute on function public.get_user_earning_status(uuid) from public, anon;
grant execute on function public.get_user_earning_status(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7. The payout queue shows what to actually send
-- ---------------------------------------------------------------------------
--
-- Three columns appended: the frozen rate, what it took, and the net. The
-- operator pays the NET — a queue that only showed the gross would have them
-- sending the fee back out again with the money.
--
-- Generated from the live definition; the return type gains three columns and
-- the select list gains the same three, in the same place.

drop function if exists public.admin_list_redemptions(public.redemption_status);

CREATE OR REPLACE FUNCTION public.admin_list_redemptions(p_status redemption_status DEFAULT NULL::redemption_status)
 RETURNS TABLE(id uuid, reference text, user_id uuid, user_name text, user_email text, user_avatar_path text, user_joined_at timestamp with time zone, paid_before integer, paid_before_ghs numeric, points bigint, ghs numeric, fee_percent numeric, fee_ghs numeric, net_ghs numeric, coin_code text, coin_amount numeric, live_coin_amount numeric, quoted_at timestamp with time zone, method payout_method, provider text, destination text, account_name text, reuse integer, status redemption_status, requested_at timestamp with time zone, status_changed_at timestamp with time zone, holding_until timestamp with time zone, admin_hold_at timestamp with time zone, approved_early boolean, risk risk_level, risk_reasons text[], decision_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_decay int := public.config_int('fraud_signal_decay_days')::int;
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id,
    'RDM-' || upper(substr(replace(r.id::text, '-', ''), 1, 6)),
    r.user_id,
    p.full_name,
    u.email::text,
    p.avatar_path,
    p.created_at,
    (select count(*)::int from public.redemptions q
      where q.user_id = r.user_id and q.status = 'paid' and q.id <> r.id),
    /* What this person has been paid before, NET — the money that actually
       left, not the gross they asked for. */
    (select coalesce(sum(coalesce(q.net_amount, q.currency_amount)), 0) from public.redemptions q
      where q.user_id = r.user_id and q.status = 'paid' and q.id <> r.id),
    r.points_amount,
    r.currency_amount,
    r.fee_percent,
    r.fee_amount,
    coalesce(r.net_amount, r.currency_amount),

    r.snapshot_coin_code,

    -- Frozen at request: what the user was quoted, and what to send. Null on
    -- mobile money, and on a crypto row filed while no fresh rate existed.
    r.coin_amount,

    /*
      Fallback, and ONLY when nothing was frozen. An operator looking at a
      Tron wallet needs a number; today's rate, labelled as today's rate,
      beats a cedi figure they cannot act on. The screen tells them apart by
      whether quoted_at is set, so a live figure is never mistaken for the
      amount the user was promised. Quoted on the NET, like the frozen one.
    */
    case
      when r.method = 'crypto' and r.coin_amount is null
        then (public.quote_crypto_payout(coalesce(r.net_amount, r.currency_amount), r.snapshot_coin_code) ->> 'coin_amount')::numeric
    end,

    r.quoted_at,

    r.method,
    case r.method
      when 'crypto' then
        coalesce(r.snapshot_coin_code, '?')
        || coalesce(' · ' || r.snapshot_network_code, '')
      else
        coalesce(pp.name, r.snapshot_provider_code, '?')
    end,
    coalesce(r.snapshot_wallet, r.snapshot_msisdn, ''),
    coalesce(r.snapshot_account_name, ''),
    (select count(distinct q.user_id)::int
       from public.redemptions q
      where q.user_id <> r.user_id
        and (
          (r.snapshot_wallet is not null and q.snapshot_wallet = r.snapshot_wallet)
          or (r.snapshot_msisdn is not null and q.snapshot_msisdn = r.snapshot_msisdn)
        )),
    r.status,
    r.created_at,
    r.updated_at,
    r.holding_until,
    r.admin_hold_at,
    r.approved_early,
    r.risk_level_at_request,
    coalesce(
      (select array_agg(x.name order by x.weight desc)
         from (
           select distinct c.code, c.name, c.weight
             from public.fraud_signals s
             join public.fraud_checks c on c.code = s.check_code
            where s.user_id = r.user_id
              and s.created_at >= now() - make_interval(days => v_decay)
         ) x),
      '{}'::text[]
    ),
    coalesce(r.failure_reason, r.review_notes)
  from public.redemptions r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id
  left join public.payout_providers pp on pp.code = r.snapshot_provider_code
  where p_status is null or r.status = p_status
  order by
    case when r.status in ('pending_approval', 'held') then 0 else 1 end,
    case when r.status in ('pending_approval', 'held') then r.created_at end asc,
    r.created_at desc;
end;
$function$;

revoke execute on function public.admin_list_redemptions(public.redemption_status) from public, anon;
grant execute on function public.admin_list_redemptions(public.redemption_status) to authenticated, service_role;
