-- ============================================================================
-- Crypto withdrawals paid automatically through PayLink.
--
-- A withdrawal to a USDC wallet on Base now leaves on its own. It still goes
-- through every existing step (requested, held, pending approval, approved,
-- paid), and the only new thing is WHO approves it: when every payout rule
-- below passes, the system does, and the money is sent through PayLink's
-- POST /payouts. When any rule fails it waits for an admin exactly as it does
-- today, with the failing rules written down next to it.
--
-- WHAT DOES NOT CHANGE
--   * The points leave the balance when the withdrawal is REQUESTED
--     (`request_redemption`). That is the "debit first" PayLink asks for.
--   * A payout PayLink rejects or fails comes back as a refund of the points,
--     through the same `credit_points` every refund here uses.
--   * Mobile money, and crypto on any other coin or network, are untouched.
--     PayLink pays USDC on Base only, and an address that works on Ethereum
--     is not proof that its owner can receive on Base: an exchange deposit
--     address very often cannot, and that money is gone.
--
-- THE AMOUNT IS IN CEDIS
-- PayLink is sent what the member receives, `net_amount` (the withdrawal less
-- the fee frozen onto it at request time), in GHS, and converts at
-- its own rate when it sends (operator, 30 September 2026). The USDC amount
-- and the rate it used are recorded here from its answer, so the admin and the
-- member see what actually left rather than the estimate made at request time.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Base as a USDC network.
--
-- Shipped INACTIVE. The operator switches it on in the admin once PayLink is
-- live, which is also when members can first choose it.
-- ----------------------------------------------------------------------------
insert into public.payout_coin_networks
  (coin_id, code, name, address_pattern, rail_confirmed, rail_notes, is_active, sort_order)
select c.id, 'BASE', 'Base', '^0x[a-fA-F0-9]{40}$', true,
       'Paid automatically through PayLink. USDC on Base only.', false, 0
  from public.payout_coins c
 where c.code = 'USDC'
on conflict (coin_id, code) do nothing;


-- ----------------------------------------------------------------------------
-- 2. What PayLink said about each withdrawal.
--
-- `paylink_status` is ours first and PayLink's after:
--   requesting  claimed by this app, the POST may or may not have landed
--   not_sent    PayLink refused the request outright (bad address, below its
--               minimum); nothing was created there, an admin decides
--   queued | held_for_review | sending | completed | rejected | failed
--               PayLink's own words
-- ----------------------------------------------------------------------------
alter table public.redemptions
  add column if not exists paylink_payout_id    text unique,
  add column if not exists paylink_status       text,
  add column if not exists paylink_failed_rules text[],
  add column if not exists paylink_amount_usdc  numeric(20, 6),
  add column if not exists paylink_rate         text,
  add column if not exists paylink_tx_hash      text,
  add column if not exists paylink_error        text,
  add column if not exists paylink_claimed_at   timestamptz,
  add column if not exists paylink_updated_at   timestamptz,
  -- The automatic decision, made once when the hold elapses.
  add column if not exists auto_decision        text
    check (auto_decision in ('auto_approved', 'needs_review')),
  add column if not exists auto_decided_at      timestamptz;

create index if not exists redemptions_paylink_open_idx
  on public.redemptions (paylink_updated_at)
  where status = 'approved' and paylink_status is not null;


-- ----------------------------------------------------------------------------
-- 3. Which withdrawals PayLink pays.
-- ----------------------------------------------------------------------------
create or replace function public.redemption_goes_through_paylink(p_r public.redemptions)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_r.method = 'crypto'
     and upper(coalesce(p_r.snapshot_coin_code, '')) = 'USDC'
     and upper(coalesce(p_r.snapshot_network_code, '')) = 'BASE';
$function$;


-- ----------------------------------------------------------------------------
-- 4. The rules, as settings.
--
-- They live in `app_config` so the admin's Platform settings screen edits them
-- with the bounds enforced by `admin_set_config`, like every other number that
-- decides how much money leaves. For every numeric rule, 0 switches it off.
--
-- The starting values are cautious on purpose. They can only be loosened by
-- somebody deciding to.
-- ----------------------------------------------------------------------------
insert into public.app_config (key, value, value_type, min_value, max_value, description, is_public) values
  ('auto_payout_enabled', 'false', 'bool', null, null,
   'Master switch for automatic crypto payouts through PayLink. Off sends every withdrawal to an admin. Nothing is ever sent while payouts_enabled is off.',
   false),
  ('auto_payout_max_ghs', '200', 'decimal', 0, 100000,
   'A withdrawal above this many cedis needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_first_withdrawals_reviewed', '1', 'int', 0, 100,
   'A member''s first this-many withdrawals need an admin. 0 switches the rule off.',
   false),
  ('auto_payout_max_withdrawals_per_window', '3', 'int', 0, 1000,
   'More than this many withdrawal requests in the window below needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_withdrawal_window_days', '7', 'int', 1, 365,
   'The window, in days, the withdrawal count above is measured over.',
   false),
  ('auto_payout_user_daily_max_ghs', '300', 'decimal', 0, 1000000,
   'A member whose withdrawals approved in the last 24 hours, including this one, pass this many cedis needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_platform_daily_max_ghs', '2000', 'decimal', 0, 10000000,
   'Once automatic payouts across the whole platform reach this many cedis today, every further withdrawal needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_min_account_age_days', '7', 'int', 0, 3650,
   'A member whose account is younger than this many days needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_review_elevated_risk', 'true', 'bool', null, null,
   'Whether a member whose fraud risk level is above low needs an admin.',
   false),
  ('auto_payout_fraud_signal_days', '7', 'int', 0, 365,
   'A member with any fraud signal in this many days needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_review_shared_wallet', 'true', 'bool', null, null,
   'Whether a wallet address that another account has used needs an admin.',
   false),
  ('auto_payout_review_new_wallet', 'true', 'bool', null, null,
   'Whether the first payout to a wallet address this member has never been paid to needs an admin.',
   false),
  ('auto_payout_max_points_earned_24h', '0', 'int', 0, 100000000,
   'A member who earned more than this many points in the last 24 hours needs an admin. 0 switches the rule off.',
   false),
  ('auto_payout_reversal_days', '90', 'int', 0, 3650,
   'A member with a reversed or refunded payment in this many days needs an admin. 0 switches the rule off.',
   false)
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- 5. Why a withdrawal was or was not approved automatically.
-- ----------------------------------------------------------------------------
create table if not exists public.redemption_rule_results (
  redemption_id uuid        not null references public.redemptions (id) on delete cascade,
  rule          text        not null,
  passed        boolean     not null,
  detail        text,
  evaluated_at  timestamptz not null default now(),
  primary key (redemption_id, rule)
);

comment on table public.redemption_rule_results is
  'One row per payout rule per withdrawal, written when the automatic decision is made. The admin queue shows the failing ones as the reason a withdrawal waits.';

alter table public.redemption_rule_results enable row level security;

create policy redemption_rule_results_admin_read on public.redemption_rule_results
  for select to authenticated using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 6. evaluate_auto_payout: the rulebook.
--
-- Writes one row per rule and answers whether they all passed. Pure reading
-- apart from that, so an admin screen can re-run it to see where a withdrawal
-- stands today.
-- ----------------------------------------------------------------------------
create or replace function public.evaluate_auto_payout(p_redemption_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_r          public.redemptions;
  v_now        timestamptz := now();
  v_num        numeric;
  v_int        bigint;
  v_count      bigint;
  v_sum        numeric;
  v_created    timestamptz;
  v_level      public.risk_level;
  v_wallet     text;
  v_amount     numeric;
  v_all        boolean;
begin
  select * into v_r from public.redemptions where id = p_redemption_id;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  v_wallet := lower(v_r.snapshot_wallet);
  -- What actually leaves: the fee comes off when the request is filed.
  -- Null on rows filed before fees existed, which means no fee.
  v_amount := coalesce(v_r.net_amount, v_r.currency_amount);
  delete from public.redemption_rule_results where redemption_id = p_redemption_id;

  -- 00. The master switch, recorded as a rule so a queue full of waiting
  -- withdrawals says why rather than looking stuck.
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '00_auto_payouts_on', public.config_bool('auto_payout_enabled'),
          case when public.config_bool('auto_payout_enabled') then 'on'
               else 'Automatic payouts are switched off' end);

  -- 01. Amount per withdrawal.
  v_num := public.config_decimal('auto_payout_max_ghs');
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '01_max_amount', v_num = 0 or v_amount <= v_num,
          case when v_num = 0 then 'off'
               else format('GHS %s; limit GHS %s', v_amount, v_num) end);

  -- 02. A member's first N withdrawals. Counts withdrawals that were PAID,
  -- by any method: a member who has been paid by mobile money has a history.
  v_int := public.config_int('auto_payout_first_withdrawals_reviewed');
  select count(*) into v_count from public.redemptions
   where user_id = v_r.user_id and status = 'paid' and id <> v_r.id;
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '02_first_withdrawals', v_int = 0 or v_count >= v_int,
          case when v_int = 0 then 'off'
               else format('%s earlier paid withdrawals; the first %s are reviewed', v_count, v_int) end);

  -- 03. How often. Every request counts, including this one, except ones the
  -- member cancelled themselves.
  v_int := public.config_int('auto_payout_max_withdrawals_per_window');
  select count(*) into v_count from public.redemptions
   where user_id = v_r.user_id and status <> 'cancelled'
     and created_at >= v_now - make_interval(days => public.config_int('auto_payout_withdrawal_window_days')::int);
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '03_withdrawal_frequency', v_int = 0 or v_count <= v_int,
          case when v_int = 0 then 'off'
               else format('%s requests in %s days including this; limit %s',
                           v_count, public.config_int('auto_payout_withdrawal_window_days'), v_int) end);

  -- 04. Per member per 24 hours, counting what was approved or paid.
  v_num := public.config_decimal('auto_payout_user_daily_max_ghs');
  select coalesce(sum(coalesce(net_amount, currency_amount)), 0) into v_sum from public.redemptions
   where user_id = v_r.user_id and id <> v_r.id
     and status in ('approved', 'paid')
     and coalesce(reviewed_at, created_at) >= v_now - interval '24 hours';
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '04_member_daily_total', v_num = 0 or v_sum + v_amount <= v_num,
          case when v_num = 0 then 'off'
               else format('GHS %s in 24h including this; limit GHS %s', v_sum + v_amount, v_num) end);

  -- 05. The circuit breaker: everything paid automatically today.
  -- Ghana keeps UTC all year, so a UTC day is a Ghana day.
  v_num := public.config_decimal('auto_payout_platform_daily_max_ghs');
  select coalesce(sum(coalesce(net_amount, currency_amount)), 0) into v_sum from public.redemptions
   where auto_decision = 'auto_approved' and id <> v_r.id
     and status in ('approved', 'paid')
     and auto_decided_at >= date_trunc('day', v_now);
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '05_platform_daily_total', v_num = 0 or v_sum + v_amount <= v_num,
          case when v_num = 0 then 'off'
               else format('GHS %s paid automatically today including this; limit GHS %s',
                           v_sum + v_amount, v_num) end);

  -- 06. Account age.
  v_int := public.config_int('auto_payout_min_account_age_days');
  select created_at into v_created from auth.users where id = v_r.user_id;
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '06_account_age',
          v_int = 0 or (v_created is not null and v_created <= v_now - make_interval(days => v_int::int)),
          case when v_int = 0 then 'off'
               else format('account created %s; minimum %s days', to_char(v_created, 'YYYY-MM-DD'), v_int) end);

  -- 07. Risk level right now, not the one frozen at request time: a member
  -- flagged during the hold is exactly who this should catch.
  select level into v_level from public.user_risk_scores where user_id = v_r.user_id;
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '07_risk_level',
          not public.config_bool('auto_payout_review_elevated_risk') or coalesce(v_level, 'low') = 'low',
          case when not public.config_bool('auto_payout_review_elevated_risk') then 'off'
               else format('risk level %s', coalesce(v_level, 'low')) end);

  -- 08. Recent fraud signals.
  v_int := public.config_int('auto_payout_fraud_signal_days');
  select count(*) into v_count from public.fraud_signals
   where user_id = v_r.user_id and created_at >= v_now - make_interval(days => v_int::int);
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '08_recent_fraud_signals', v_int = 0 or v_count = 0,
          case when v_int = 0 then 'off'
               else format('%s fraud signals in %s days', v_count, v_int) end);

  -- 09. A wallet another account uses: the plainest sign of one person
  -- running several accounts.
  select count(distinct user_id) into v_count from (
    select user_id from public.redemptions
     where lower(snapshot_wallet) = v_wallet and user_id <> v_r.user_id
    union
    select user_id from public.user_payout_details
     where lower(wallet_address) = v_wallet and user_id <> v_r.user_id
  ) other_accounts;
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '09_wallet_not_shared',
          not public.config_bool('auto_payout_review_shared_wallet') or v_count = 0,
          case when not public.config_bool('auto_payout_review_shared_wallet') then 'off'
               else format('%s other accounts use this wallet', v_count) end);

  -- 10. First payout to this wallet.
  select count(*) into v_count from public.redemptions
   where user_id = v_r.user_id and id <> v_r.id and status = 'paid'
     and lower(snapshot_wallet) = v_wallet;
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '10_known_wallet',
          not public.config_bool('auto_payout_review_new_wallet') or v_count > 0,
          case when not public.config_bool('auto_payout_review_new_wallet') then 'off'
               else format('%s earlier payouts to this wallet', v_count) end);

  -- 11. Earning too fast. Refunds of earlier withdrawals are not earnings.
  v_int := public.config_int('auto_payout_max_points_earned_24h');
  select coalesce(sum(amount), 0) into v_sum from public.points_ledger
   where user_id = v_r.user_id and amount > 0
     and entry_type <> 'redemption_refund'
     and created_at >= v_now - interval '24 hours';
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '11_earning_speed', v_int = 0 or v_sum <= v_int,
          case when v_int = 0 then 'off'
               else format('%s points earned in 24h; limit %s', v_sum, v_int) end);

  -- 12. A reversed or refunded payment: somebody who took a plan back.
  v_int := public.config_int('auto_payout_reversal_days');
  select (select count(*) from public.subscription_payments
           where user_id = v_r.user_id and status = 'refunded'
             and created_at >= v_now - make_interval(days => v_int::int))
       + (select count(*) from public.vault_payments
           where user_id = v_r.user_id and status = 'refunded'
             and created_at >= v_now - make_interval(days => v_int::int))
    into v_count;
  insert into public.redemption_rule_results (redemption_id, rule, passed, detail)
  values (p_redemption_id, '12_no_recent_reversal', v_int = 0 or v_count = 0,
          case when v_int = 0 then 'off'
               else format('%s reversed payments in %s days', v_count, v_int) end);

  select bool_and(passed) into v_all
    from public.redemption_rule_results where redemption_id = p_redemption_id;
  return coalesce(v_all, false);
end;
$function$;

revoke execute on function public.evaluate_auto_payout(uuid) from public, anon, authenticated;
grant  execute on function public.evaluate_auto_payout(uuid) to service_role;


-- ----------------------------------------------------------------------------
-- 7. auto_approve_redemption: the system taking the decision an admin would.
--
-- Once per withdrawal, when its hold has elapsed. A withdrawal that needs an
-- admin stays `pending_approval` and is NOT re-decided later on its own, even
-- if a rule would pass tomorrow: once a person has been asked, it is theirs.
--
-- Approval records no admin (`reviewed_by` stays null) and says so in the
-- notes, so the audit trail never shows a person approving something they
-- did not see.
-- ----------------------------------------------------------------------------
create or replace function public.auto_approve_redemption(p_redemption_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_r      public.redemptions;
  v_passed boolean;
begin
  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;

  if v_r.status <> 'pending_approval' then return 'not_pending'; end if;
  if not public.redemption_goes_through_paylink(v_r) then return 'not_eligible'; end if;
  if v_r.auto_decision is not null then return v_r.auto_decision; end if;

  v_passed := public.evaluate_auto_payout(p_redemption_id)
              and public.config_bool('payouts_enabled');

  if v_passed then
    update public.redemptions
       set status          = 'approved',
           reviewed_at     = now(),
           review_notes    = 'Approved automatically: every payout rule passed.',
           auto_decision   = 'auto_approved',
           auto_decided_at = now(),
           updated_at      = now()
     where id = p_redemption_id;
    return 'auto_approved';
  end if;

  update public.redemptions
     set auto_decision = 'needs_review', auto_decided_at = now(), updated_at = now()
   where id = p_redemption_id;
  return 'needs_review';
end;
$function$;

revoke execute on function public.auto_approve_redemption(uuid) from public, anon, authenticated;
grant  execute on function public.auto_approve_redemption(uuid) to service_role;


-- ----------------------------------------------------------------------------
-- 8. claim_paylink_payout: the lock that stops a payout being sent twice, or
-- sent while an admin declines it.
--
-- Only an approved PayLink withdrawal with nothing sent yet can be claimed,
-- or one whose earlier claim is more than two minutes old (the request died
-- in flight; sending again is safe because PayLink answers a repeated
-- payout_ref with the payout it already has).
-- ----------------------------------------------------------------------------
create or replace function public.claim_paylink_payout(p_redemption_id uuid)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_r public.redemptions;
begin
  if not public.config_bool('payouts_enabled') then
    raise exception 'Payouts are disabled. Enable them only once the money-service licence is confirmed.'
      using errcode = 'check_violation';
  end if;

  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found' using errcode = 'check_violation';
  end if;
  if v_r.status <> 'approved' or not public.redemption_goes_through_paylink(v_r) then
    return null;
  end if;
  if v_r.paylink_status is not null
     and not (v_r.paylink_status = 'requesting' and v_r.paylink_claimed_at < now() - interval '2 minutes') then
    return null;
  end if;

  update public.redemptions
     set paylink_status = 'requesting', paylink_claimed_at = now(),
         paylink_updated_at = now(), updated_at = now()
   where id = p_redemption_id
  returning * into v_r;
  return v_r;
end;
$function$;

revoke execute on function public.claim_paylink_payout(uuid) from public, anon, authenticated;
grant  execute on function public.claim_paylink_payout(uuid) to service_role;


-- PayLink refused the request itself (400: bad address, below its minimum).
-- Nothing exists there, so the withdrawal goes back to an admin with the
-- reason, still approved and still holding the member's points.
create or replace function public.paylink_payout_not_sent(p_redemption_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.redemptions
     set paylink_status = 'not_sent', paylink_error = p_error,
         paylink_updated_at = now(), updated_at = now()
   where id = p_redemption_id and paylink_status = 'requesting' and paylink_payout_id is null;

  insert into public.system_alerts (severity, code, message, context)
  values ('warning', 'paylink_payout_not_sent',
    format('PayLink refused the payout for redemption %s. An admin needs to decide it.', p_redemption_id),
    jsonb_build_object('redemption_id', p_redemption_id, 'error', p_error));
end;
$function$;

revoke execute on function public.paylink_payout_not_sent(uuid, text) from public, anon, authenticated;
grant  execute on function public.paylink_payout_not_sent(uuid, text) to service_role;


-- ----------------------------------------------------------------------------
-- 9. apply_paylink_payout: what a PayLink payout object does to a withdrawal.
--
-- Called from the IPN, from the send itself, and from the sweep. They race by
-- design, so every branch is idempotent: a second `completed` is a no-op, a
-- second `failed` does not refund twice.
-- ----------------------------------------------------------------------------
create or replace function public.apply_paylink_payout(
  p_redemption_id uuid,
  p_payout_id     text,
  p_status        text,
  p_failed_rules  text[] default null,
  p_amount_usdc   numeric default null,
  p_rate          text default null,
  p_tx_hash       text default null,
  p_reason        text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_r public.redemptions;
begin
  select * into v_r from public.redemptions where id = p_redemption_id for update;
  if not found then return 'unknown'; end if;

  if v_r.paylink_payout_id is not null and v_r.paylink_payout_id <> p_payout_id then
    insert into public.system_alerts (severity, code, message, context)
    values ('critical', 'paylink_payout_id_conflict',
      format('PayLink reported payout %s for redemption %s, which is already tied to %s.',
             p_payout_id, p_redemption_id, v_r.paylink_payout_id),
      jsonb_build_object('redemption_id', p_redemption_id, 'reported', p_payout_id,
                         'recorded', v_r.paylink_payout_id));
    return 'conflict';
  end if;

  update public.redemptions
     set paylink_payout_id    = p_payout_id,
         paylink_status       = p_status,
         paylink_failed_rules = coalesce(p_failed_rules, paylink_failed_rules),
         paylink_amount_usdc  = coalesce(p_amount_usdc, paylink_amount_usdc),
         paylink_rate         = coalesce(p_rate, paylink_rate),
         paylink_tx_hash      = coalesce(p_tx_hash, paylink_tx_hash),
         paylink_error        = case when p_status in ('rejected', 'failed') then p_reason else paylink_error end,
         paylink_updated_at   = now(),
         updated_at           = now()
   where id = p_redemption_id;

  if p_status = 'completed' then
    if v_r.status = 'paid' then return 'already_done'; end if;
    if v_r.status <> 'approved' then
      -- Money left for a withdrawal we no longer consider approved. The member
      -- may now hold both the payout and a refund. A person must look.
      insert into public.system_alerts (severity, code, message, context)
      values ('critical', 'paylink_paid_unexpected_state',
        format('PayLink completed a payout for redemption %s, which is %s here.', p_redemption_id, v_r.status),
        jsonb_build_object('redemption_id', p_redemption_id, 'status', v_r.status, 'payout_id', p_payout_id));
      return 'anomaly';
    end if;

    -- ⚠️ No licence check here, unlike mark_redemption_paid. The check guards
    -- SENDING (claim_paylink_payout), and by now the money has left: refusing
    -- to record that would leave the ledger saying it did not.
    update public.redemptions
       set status = 'paid', paid_at = now(),
           external_reference = coalesce(p_tx_hash, p_payout_id), updated_at = now()
     where id = p_redemption_id;
    return 'paid';
  end if;

  if p_status in ('rejected', 'failed') then
    if v_r.status in ('failed', 'rejected') then return 'already_done'; end if;
    if v_r.status <> 'approved' then
      insert into public.system_alerts (severity, code, message, context)
      values ('critical', 'paylink_failed_unexpected_state',
        format('PayLink reported payout %s as %s for redemption %s, which is %s here.',
               p_payout_id, p_status, p_redemption_id, v_r.status),
        jsonb_build_object('redemption_id', p_redemption_id, 'status', v_r.status, 'payout_id', p_payout_id));
      return 'anomaly';
    end if;

    perform public.credit_points(
      v_r.user_id, v_r.points_amount, 'redemption_refund', 'redemption', p_redemption_id::text,
      jsonb_build_object('reason', 'PayLink payout ' || p_status || ': ' || coalesce(p_reason, 'no reason given'))
    );

    update public.redemptions
       set status         = case when p_status = 'rejected' then 'rejected' else 'failed' end::public.redemption_status,
           failure_reason = coalesce(p_reason, 'PayLink payout ' || p_status),
           review_notes   = case when p_status = 'rejected' then coalesce(p_reason, review_notes) else review_notes end,
           updated_at     = now()
     where id = p_redemption_id;

    insert into public.system_alerts (severity, code, message, context)
    values (case when p_status = 'failed' then 'critical' else 'warning' end::public.alert_severity,
      'paylink_payout_' || p_status,
      format('PayLink %s the payout for redemption %s. The points were refunded.', p_status, p_redemption_id),
      jsonb_build_object('redemption_id', p_redemption_id, 'payout_id', p_payout_id, 'reason', p_reason));
    return 'refunded';
  end if;

  return 'recorded';
end;
$function$;

revoke execute on function public.apply_paylink_payout(uuid, text, text, text[], numeric, text, text, text)
  from public, anon, authenticated;
grant  execute on function public.apply_paylink_payout(uuid, text, text, text[], numeric, text, text, text)
  to service_role;


-- ----------------------------------------------------------------------------
-- 10. An admin cannot settle by hand what PayLink is settling.
--
-- Verbatim from the redemption pipeline, plus one guard each. Marking a
-- PayLink payout paid by hand would stop it being recorded when PayLink
-- confirms; declining one in flight would refund points for money that is
-- about to arrive in the member's wallet.
-- ----------------------------------------------------------------------------
create or replace function public.paylink_is_settling(v_r public.redemptions)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select v_r.paylink_status is not null
     and v_r.paylink_status not in ('not_sent', 'rejected', 'failed');
$function$;

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

  if public.paylink_is_settling(v_r) then
    raise exception 'This payout was sent through PayLink. It is marked paid when PayLink confirms it.'
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

  if public.paylink_is_settling(v_r) then
    raise exception 'This payout was sent through PayLink and may already be on its way. Reject it in PayLink instead; the points come back when PayLink reports it.'
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


-- ----------------------------------------------------------------------------
-- 11. The clock: every five minutes, the same way the payment sweep is rung.
-- This is a Hobby plan, whose two Vercel cron slots are spent.
-- ----------------------------------------------------------------------------
create or replace function public.ring_paylink_payouts()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret  text;
  v_base    text;
  v_request bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_secret is null or btrim(v_secret) = '' then
    raise warning 'PayLink payouts are scheduled but vault holds no cron_secret, so nothing was called.';
    return null;
  end if;

  select value into v_base from public.app_config where key = 'site_base_url';
  if v_base is null then
    raise warning 'PayLink payouts are scheduled but app_config has no site_base_url.';
    return null;
  end if;

  select net.http_get(
    url := rtrim(v_base, '/') || '/api/cron/paylink-payouts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_request;
  return v_request;
end;
$function$;

revoke execute on function public.ring_paylink_payouts() from public, anon, authenticated;
grant  execute on function public.ring_paylink_payouts() to service_role;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'paylink-payouts') then
    perform cron.unschedule('paylink-payouts');
  end if;
end;
$do$;

select cron.schedule(
  'paylink-payouts',
  '*/5 * * * *',
  $cron$select public.ring_paylink_payouts()$cron$
);
