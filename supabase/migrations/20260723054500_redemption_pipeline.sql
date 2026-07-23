-- ============================================================================
-- Migration 018 — Redemption pipeline (§6.4)
--
-- Request, hold, review, approve, disburse. Built end to end; the final
-- disbursement step stays behind the licence flag until the operator turns it
-- on (§2.3).
--
-- Two independent switches must both be on before money moves:
--   payouts_enabled          (app_config, admin-editable)
--   PAYOUTS_ENABLED          (environment variable, checked in application code)
--
-- One switch would be enough for a normal feature. This is money leaving the
-- business before a money-service licence exists, so it gets two, in different
-- systems, both defaulting to off. Flipping a config row by accident should
-- not be sufficient to start paying people.
--
-- The destination is SNAPSHOTTED at request time
-- ----------------------------------------------
-- A redemption stores where it is going, not a pointer to the user's current
-- payout details. If an account is taken over and the wallet address changed,
-- anything already in flight still pays the destination the real user agreed
-- to. Without the snapshot, a takeover redirects money that was already
-- queued — and the holding period, which exists to catch exactly that, would
-- be protecting a moving target.
--
-- Points leave the balance at REQUEST, not at approval
-- ----------------------------------------------------
-- Otherwise a user with 30,000 points submits ten 30,000-point requests before
-- any settles, and the platform owes 300,000. Deducting on request keeps the
-- balance honest at every instant. Rejection and cancellation refund in full.
-- ============================================================================


create type public.redemption_status as enum (
  'held',              -- inside the fraud-catch window; visible to admins immediately
  'pending_approval',  -- hold elapsed, awaiting an admin decision
  'approved',          -- admin approved; awaiting disbursement
  'paid',              -- money actually sent
  'rejected',          -- admin refused; points refunded
  'cancelled',         -- user withdrew during the hold; points refunded
  'failed'             -- disbursement attempted and failed; points refunded
);


create table public.redemptions (
  id uuid primary key default gen_random_uuid(),

  -- RESTRICT, consistent with points_ledger: a user with payout history is
  -- disabled, not deleted.
  user_id uuid not null references auth.users (id) on delete restrict,

  status public.redemption_status not null default 'held',
  method public.payout_method not null,

  -- --- Amounts -------------------------------------------------------------
  points_amount bigint not null check (points_amount > 0),

  -- Conversion applied at request using the rate then in force (§6.4). The
  -- point is pegged to the cedi, so this should never move — recording it
  -- anyway means a future change is provably forward-only.
  points_per_currency_unit bigint not null check (points_per_currency_unit > 0),
  currency_code   char(3) not null default 'GHS',
  currency_amount numeric(18,2) not null check (currency_amount > 0),

  -- --- Destination snapshot (see header) -----------------------------------
  snapshot_coin_code     text,
  snapshot_network_code  text,
  snapshot_wallet        text,
  snapshot_provider_code text,
  snapshot_msisdn        text,
  snapshot_account_name  text,

  -- --- Hold and review -----------------------------------------------------
  holding_until timestamptz not null,

  risk_score_at_request int not null default 0,
  risk_level_at_request public.risk_level not null default 'low',

  reviewed_by  uuid references auth.users (id) on delete set null,
  reviewed_at  timestamptz,
  review_notes text,

  -- Audited override of the holding period. Deliberately separate from a
  -- normal approval so a compromised admin account cannot quietly drain the
  -- queue without leaving an obvious trace.
  approved_early        boolean not null default false,
  early_approval_reason text,

  -- --- Disbursement --------------------------------------------------------
  paid_at            timestamptz,
  external_reference text,
  failure_reason     text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint redemptions_destination_shape check (
    case method
      when 'crypto' then
        snapshot_coin_code is not null and snapshot_wallet is not null
        and snapshot_provider_code is null and snapshot_msisdn is null
      when 'mobile_money' then
        snapshot_provider_code is not null and snapshot_msisdn is not null
        and snapshot_account_name is not null
        and snapshot_coin_code is null and snapshot_wallet is null
    end
  ),

  constraint redemptions_early_needs_reason check (
    not approved_early or (early_approval_reason is not null and length(trim(early_approval_reason)) >= 5)
  ),

  constraint redemptions_paid_has_time check (status <> 'paid' or paid_at is not null)
);

comment on table public.redemptions is
  'Redemption requests. Destination is snapshotted at request so a later payout-detail change cannot redirect money already in flight (§6.4.1).';

-- The admin queue: oldest first within status.
create index redemptions_status_created_idx on public.redemptions (status, created_at);
-- The sweep that moves held -> pending_approval.
create index redemptions_holding_idx on public.redemptions (holding_until) where status = 'held';
-- A user's own history.
create index redemptions_user_created_idx on public.redemptions (user_id, created_at desc);
create index redemptions_reviewer_idx on public.redemptions (reviewed_by) where reviewed_by is not null;

create trigger redemptions_touch_updated_at
  before update on public.redemptions
  for each row execute function public.touch_updated_at();

create trigger redemptions_audit
  after insert or update or delete on public.redemptions
  for each row execute function public.audit_row_change('id');


-- ---------------------------------------------------------------------------
-- request_redemption
-- ---------------------------------------------------------------------------

create type public.redemption_request_result as (
  redemption_id uuid,
  status        public.redemption_status,
  points        bigint,
  currency      numeric,
  holding_until timestamptz,
  message       text
);

create or replace function public.request_redemption(
  p_user_id uuid,
  p_method  public.payout_method,
  p_points  bigint,
  p_ip      inet default null
)
returns public.redemption_request_result
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Payout details must be complete for the chosen method (§6.4.1).
  select * into v_details from public.user_payout_details
   where user_id = p_user_id and method = p_method;
  if not found then
    raise exception 'Add your % details before requesting a payout',
      case p_method when 'crypto' then 'crypto wallet' else 'mobile money' end
      using errcode = 'check_violation';
  end if;

  -- Cool-off after changing where the money goes (§6.4.1). Operator confirmed
  -- this applies uniformly across tiers.
  v_cooloff_h := public.config_int('payout_details_change_cooloff_hours')::int;
  if v_cooloff_h > 0 then
    v_age_hours := extract(epoch from (now() - v_details.last_changed_at)) / 3600.0;
    if v_age_hours < v_cooloff_h then
      raise exception 'Payout details were changed recently. You can request a payout in %s hour(s).',
        ceil(v_cooloff_h - v_age_hours) using errcode = 'check_violation';
    end if;
  end if;

  -- Per-tier minimum (§6.4), identical across methods.
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

  -- Debit first. A failure here (insufficient balance) aborts before any
  -- redemption row exists.
  perform public.debit_points(
    p_user_id, p_points, 'redemption_request', 'redemption', 'pending',
    jsonb_build_object('method', p_method, 'currency_amount', v_amount)
  );

  select * into v_risk from public.user_risk_scores where user_id = p_user_id;

  if p_method = 'crypto' then
    select * into v_coin    from public.payout_coins          where id = v_details.coin_id;
    select * into v_network from public.payout_coin_networks  where id = v_details.network_id;
  else
    select * into v_provider from public.payout_providers     where id = v_details.provider_id;
  end if;

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

  perform public.record_auth_signal(p_user_id, 'redemption_request', p_ip);

  -- A brand new account reaching the minimum unusually fast is a farming
  -- signal (§7).
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


-- ---------------------------------------------------------------------------
-- release_matured_holds — held -> pending_approval
-- ---------------------------------------------------------------------------
--
-- Runs on a schedule. Deliberately a sweep rather than computing status at
-- read time, so the admin queue is a plain indexed query and the transition is
-- a recorded event.

create or replace function public.release_matured_holds()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  update public.redemptions
     set status = 'pending_approval', updated_at = now()
   where status = 'held'
     and holding_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.release_matured_holds() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- approve_redemption
-- ---------------------------------------------------------------------------
--
-- Approval marks intent to pay. It does NOT move money — disbursement is a
-- separate step behind the licence flag.
--
-- p_approve_early is the audited override the operator asked for: an admin may
-- bypass the holding period, but it is a distinct action that records who did
-- it and why, and it demands a reason.

create or replace function public.approve_redemption(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_notes         text default null,
  p_approve_early boolean default false,
  p_early_reason  text default null
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r   public.redemptions;
  v_out public.redemptions;
begin
  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status not in ('held', 'pending_approval') then
    raise exception 'Cannot approve a redemption with status %', v_r.status
      using errcode = 'check_violation';
  end if;

  if v_r.status = 'held' then
    if not p_approve_early then
      raise exception 'Still inside the holding period until %. Use the early-approval override to proceed now.',
        v_r.holding_until using errcode = 'check_violation';
    end if;
    if p_early_reason is null or length(trim(p_early_reason)) < 5 then
      raise exception 'Early approval requires a reason' using errcode = 'check_violation';
    end if;
  end if;

  update public.redemptions
     set status                = 'approved',
         reviewed_by           = p_admin_id,
         reviewed_at           = now(),
         review_notes          = p_notes,
         approved_early        = (v_r.status = 'held'),
         early_approval_reason = case when v_r.status = 'held' then trim(p_early_reason) end,
         updated_at            = now()
   where id = p_redemption_id
  returning * into v_out;

  -- An override of a fraud control is worth an operational alert, not just an
  -- audit row nobody reads until something goes wrong.
  if v_out.approved_early then
    insert into public.system_alerts (severity, code, message, context)
    values ('warning', 'redemption_approved_early',
      format('Redemption %s approved before its holding period elapsed.', p_redemption_id),
      jsonb_build_object('redemption_id', p_redemption_id, 'admin_id', p_admin_id,
                         'holding_until', v_r.holding_until, 'reason', trim(p_early_reason)));
  end if;

  return v_out;
end;
$$;

revoke execute on function public.approve_redemption(uuid, uuid, text, boolean, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- reject_redemption / cancel_redemption — both refund in full
-- ---------------------------------------------------------------------------

create or replace function public.reject_redemption(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_reason        text
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare v_r public.redemptions; v_out public.redemptions;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A rejection reason is required' using errcode = 'check_violation';
  end if;

  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status not in ('held', 'pending_approval', 'approved') then
    raise exception 'Cannot reject a redemption with status %', v_r.status
      using errcode = 'check_violation';
  end if;

  -- Refund reaches a disabled account by design: disabling must not
  -- confiscate points the user already earned.
  perform public.credit_points(
    v_r.user_id, v_r.points_amount, 'redemption_refund', 'redemption', p_redemption_id::text,
    jsonb_build_object('reason', trim(p_reason), 'rejected_by', p_admin_id)
  );

  update public.redemptions
     set status = 'rejected', reviewed_by = p_admin_id, reviewed_at = now(),
         review_notes = trim(p_reason), updated_at = now()
   where id = p_redemption_id
  returning * into v_out;

  return v_out;
end;
$$;

revoke execute on function public.reject_redemption(uuid, uuid, text) from public, anon, authenticated;


create or replace function public.cancel_redemption(
  p_user_id       uuid,
  p_redemption_id uuid
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare v_r public.redemptions; v_out public.redemptions;
begin
  select * into v_r from public.redemptions
   where id = p_redemption_id and user_id = p_user_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  -- Only while still held. Once an admin has approved it, withdrawal is no
  -- longer the user's call.
  if v_r.status <> 'held' then
    raise exception 'This request can no longer be cancelled (status %)', v_r.status
      using errcode = 'check_violation';
  end if;

  perform public.credit_points(
    v_r.user_id, v_r.points_amount, 'redemption_refund', 'redemption', p_redemption_id::text,
    jsonb_build_object('reason', 'cancelled by user')
  );

  update public.redemptions
     set status = 'cancelled', updated_at = now()
   where id = p_redemption_id
  returning * into v_out;

  return v_out;
end;
$$;

revoke execute on function public.cancel_redemption(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- mark_redemption_paid / mark_redemption_failed — the licence gate
-- ---------------------------------------------------------------------------
--
-- The only place a redemption becomes 'paid'. Refuses outright while the
-- licence flag is off, so the disbursement path can be built, tested and
-- reviewed now without any possibility of moving money early (§2.3).

create or replace function public.mark_redemption_paid(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_reference     text
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare v_r public.redemptions; v_out public.redemptions;
begin
  if not public.config_bool('payouts_enabled') then
    raise exception 'Payouts are disabled. Enable them only once the money-service licence is confirmed.'
      using errcode = 'check_violation';
  end if;

  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status <> 'approved' then
    raise exception 'Only an approved redemption can be marked paid (status %)', v_r.status
      using errcode = 'check_violation';
  end if;

  update public.redemptions
     set status = 'paid', paid_at = now(),
         external_reference = p_reference, updated_at = now()
   where id = p_redemption_id
  returning * into v_out;

  return v_out;
end;
$$;

revoke execute on function public.mark_redemption_paid(uuid, uuid, text) from public, anon, authenticated;


create or replace function public.mark_redemption_failed(
  p_admin_id      uuid,
  p_redemption_id uuid,
  p_reason        text
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare v_r public.redemptions; v_out public.redemptions;
begin
  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status <> 'approved' then
    raise exception 'Only an approved redemption can fail (status %)', v_r.status
      using errcode = 'check_violation';
  end if;

  -- A failed transfer must return the points. Otherwise the user has neither
  -- their points nor their money, which is the worst outcome available.
  perform public.credit_points(
    v_r.user_id, v_r.points_amount, 'redemption_refund', 'redemption', p_redemption_id::text,
    jsonb_build_object('reason', 'disbursement failed: ' || coalesce(p_reason, 'unknown'))
  );

  update public.redemptions
     set status = 'failed', failure_reason = p_reason, updated_at = now()
   where id = p_redemption_id
  returning * into v_out;

  insert into public.system_alerts (severity, code, message, context)
  values ('critical', 'redemption_disbursement_failed',
    format('Disbursement failed for redemption %s. Points were refunded.', p_redemption_id),
    jsonb_build_object('redemption_id', p_redemption_id, 'reason', p_reason));

  return v_out;
end;
$$;

revoke execute on function public.mark_redemption_failed(uuid, uuid, text) from public, anon, authenticated;


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.redemptions enable row level security;

-- A user sees their own requests and their status; the snapshot columns are
-- their own details, so nothing leaks.
create policy "Read own redemptions or all as admin"
  on public.redemptions for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- No write policy for anyone. Every transition runs through the functions
-- above, which is what guarantees points are debited and refunded exactly once.


-- ============================================================================
-- Config
-- ============================================================================

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description) values
  ('payouts_enabled', 'false', 'bool', null, null, true,
   'Master switch for real disbursement (§2.3). Must stay false until the money-service licence is confirmed. The environment variable PAYOUTS_ENABLED must ALSO be true — two switches in different systems, both defaulting off.'),
  ('fraud_rapid_redemption_days', '3', 'int', 0, 365, false,
   'An account younger than this that requests a payout is flagged as a possible farm.');
