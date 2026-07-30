-- ============================================================================
-- Migration 063 — a crypto payout is denominated in the coin, not in cedis
--
-- Operator, 2026-07-29: "if the withdrawal is made in USDT or USDC make it
-- show the amount in the respective currency or coin not cedis, cedis is for
-- the mobile money option only."
--
-- They are right, and the worst instance of it is not on the user's screen.
-- The admin payout drawer asks the operator to confirm "Send GHS 42.00 to
-- TR7NHq••••Lj6t" — a cedi figure, to a Tron wallet. Nobody can act on that.
-- Until now there was nothing else it COULD say: `redemptions` stored
-- `currency_amount` in cedis and no coin amount existed anywhere.
--
-- WHAT IS STORED, AND WHY IT IS FROZEN HERE
-- The quote is taken at request time and written onto the row, exactly the way
-- `points_per_currency_unit` already is. Re-deriving it later would mean the
-- amount owed silently changed every time somebody opened the screen, and two
-- admins looking at the same request an hour apart would be told to send
-- different amounts.
--
-- CEDIS DO NOT GO AWAY. `currency_amount` stays, and stays authoritative for
-- accounting: the point is pegged to the cedi, the ledger is in points, and
-- the platform's liability is a cedi figure. What changes is what a human is
-- shown for a crypto request, and what the operator is told to send.
--
-- A MISSING RATE DOES NOT BLOCK A WITHDRAWAL. If both providers are down and
-- the stored rate has aged out, the coin columns are left null and the request
-- still goes through. The user is owed the cedi value either way, and refusing
-- a payout because a third-party price API was unreachable would be the wrong
-- trade. The admin screen quotes live in that case and says so.
-- ============================================================================

alter table public.redemptions
  -- 8dp: more than any of these chains settle to, and enough that a large
  -- payout does not lose value to rounding on the way in.
  add column if not exists coin_amount numeric(24, 8) check (coin_amount is null or coin_amount > 0),
  add column if not exists coin_usd    numeric(20, 10) check (coin_usd is null or coin_usd > 0),
  add column if not exists usd_ghs     numeric(20, 10) check (usd_ghs is null or usd_ghs > 0),
  add column if not exists quoted_at   timestamptz;

comment on column public.redemptions.coin_amount is
  'Indicative coin amount at request time, frozen. Null when no fresh rate was available, or when the method is mobile money. Cedis remain authoritative for accounting — see currency_amount.';

-- Only a crypto request may carry a quote. A cedi payout with a coin amount
-- attached would be a bug that only surfaced on somebody's payout screen.
alter table public.redemptions
  drop constraint if exists redemptions_quote_is_crypto_only;
alter table public.redemptions
  add constraint redemptions_quote_is_crypto_only check (
    method = 'crypto' or (coin_amount is null and coin_usd is null and usd_ghs is null)
  );


-- ---------------------------------------------------------------------------
-- request_redemption — restated, with the quote written onto the row
-- ---------------------------------------------------------------------------
--
-- The live definition, with one block added before the INSERT and four columns
-- added to it. Everything else — the cool-off, the tier minimum, the holding
-- period, the fraud signals, the debit — is unchanged and deliberately left
-- byte-for-byte as it was.

create or replace function public.request_redemption(
  p_user_id uuid,
  p_method  public.payout_method,
  p_points  bigint,
  p_ip      inet default null
)
returns public.redemption_request_result
language plpgsql
security definer
set search_path to ''
as $function$
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

    -- Null when a rate is missing or stale. Deliberately not fatal: see the
    -- header. The request is still valid and still owed.
    v_quote := public.quote_crypto_payout(v_amount, v_coin.code);
  else
    select * into v_provider from public.payout_providers     where id = v_details.provider_id;
  end if;

  insert into public.redemptions (
    user_id, status, method,
    points_amount, points_per_currency_unit, currency_amount,
    coin_amount, coin_usd, usd_ghs, quoted_at,
    snapshot_coin_code, snapshot_network_code, snapshot_wallet,
    snapshot_provider_code, snapshot_msisdn, snapshot_account_name,
    holding_until, risk_score_at_request, risk_level_at_request
  )
  values (
    p_user_id, 'held', p_method,
    p_points, v_rate, v_amount,
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


-- ---------------------------------------------------------------------------
-- admin_list_redemptions — hand the coin amount to the payout queue
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated: the return type gains four columns, which CREATE OR
-- REPLACE cannot do. The body is the LIVE definition (migration 059, after
-- disputes were removed) with the coin columns added and nothing else
-- touched.
--
-- Taken from the live definition on purpose. The first draft of this file
-- copied the body out of migration 057, which still selected
-- `r.dispute_reason` — a column dropped two migrations later. It applied
-- cleanly and then failed at query time. When restating a function, read what
-- is running, never the migration that first created it.

drop function if exists public.admin_list_redemptions(public.redemption_status);

create function public.admin_list_redemptions(
  p_status public.redemption_status default null
)
returns table (
  id uuid, reference text, user_id uuid, user_name text, user_email text,
  user_avatar_path text, user_joined_at timestamptz, paid_before integer,
  paid_before_ghs numeric, points bigint, ghs numeric,
  coin_code text, coin_amount numeric, live_coin_amount numeric, quoted_at timestamptz,
  method public.payout_method,
  provider text, destination text, account_name text, reuse integer,
  status public.redemption_status, requested_at timestamptz,
  status_changed_at timestamptz, holding_until timestamptz,
  admin_hold_at timestamptz, approved_early boolean, risk public.risk_level,
  risk_reasons text[], decision_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    (select coalesce(sum(q.currency_amount), 0) from public.redemptions q
      where q.user_id = r.user_id and q.status = 'paid' and q.id <> r.id),
    r.points_amount,
    r.currency_amount,

    r.snapshot_coin_code,

    -- Frozen at request: what the user was quoted, and what to send. Null on
    -- mobile money, and on a crypto row filed while no fresh rate existed.
    r.coin_amount,

    /*
      Fallback, and ONLY when nothing was frozen. An operator looking at a
      Tron wallet needs a number; today's rate, labelled as today's rate,
      beats a cedi figure they cannot act on. The screen tells them apart by
      whether quoted_at is set, so a live figure is never mistaken for the
      amount the user was promised.
    */
    case
      when r.method = 'crypto' and r.coin_amount is null
        then (public.quote_crypto_payout(r.currency_amount, r.snapshot_coin_code) ->> 'coin_amount')::numeric
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
$$;

comment on function public.admin_list_redemptions(public.redemption_status) is
  'The payout queue with the facts a decision needs, including what to actually send: coin_amount is frozen at request, live_coin_amount is today''s rate and appears only when nothing was frozen. Destinations come back whole and are masked at render.';

revoke execute on function public.admin_list_redemptions(public.redemption_status) from public, anon;
grant execute on function public.admin_list_redemptions(public.redemption_status)
  to authenticated, service_role;
