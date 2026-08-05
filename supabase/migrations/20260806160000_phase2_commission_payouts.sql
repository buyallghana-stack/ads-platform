-- ============================================================================
-- Migration 127 — PHASE 2, M9: withdrawing commission
--
-- Gate G4, approved 2026-08-06. Operator: *"use the same withdrawal fee and
-- method framework for the affiliate marketing too."*
--
-- So this is Phase 1's payout machinery applied to a second currency, not a
-- second machinery. Concretely:
--
--   ONE FEE ACROSS THE PLATFORM. `redemption_fee_percent` is shared rather
--   than copied into an affiliate-specific key. "The same withdrawal fee"
--   taken literally: one number, one place to change it. If the two businesses
--   ever need to differ, that is a new key and a deliberate decision — not
--   something that drifts because somebody edited one of two settings.
--
--   THE SAME DESTINATION. `user_payout_details` already holds where a person's
--   money goes; nobody re-enters their MoMo number for a second business. But
--   the destination is SNAPSHOTTED onto the request, exactly as Phase 1's
--   redemptions do, so changing details later cannot redirect money already
--   approved. Same reason Phase 1 does it, same threat: take over an account,
--   change the destination, withdraw.
--
--   THE SAME RAILS. Mobile money and crypto, and crypto is denominated in
--   COIN, quoted and frozen at request time through `quote_crypto_payout`.
--   That is a locked Phase 1 rule and it exists because the coin price moves
--   between request and disbursement; whoever asked for 12 USDT gets 12 USDT.
--
-- (Buying plans and products WITH crypto is a later piece of work. Nothing
-- here blocks it — `order_payment_method` already carries `crypto`.)
--
-- ---------------------------------------------------------------------------
-- HOW THIS TOUCHES THE LEDGER, WHICH IS THE PART TO GET RIGHT
--
-- Requesting writes a negative `payout` row into `commission_ledger`
-- IMMEDIATELY, with status `requested`. `affiliate_balance_minor` sums
-- cleared + requested + paid, so the money leaves the available balance the
-- instant it is asked for. Without that, three requests could be filed against
-- one balance before any of them was approved.
--
-- Rejecting flips THAT ROW to `reversed`. A status change on the same row —
-- deliberately NOT a compensating credit. Migration 116 exists because doing
-- both took the money off twice, and this is the same trap wearing different
-- clothes.
-- ============================================================================

do $$ begin
  create type public.commission_payout_status as enum
    ('requested', 'approved', 'paid', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;


create table if not exists public.commission_payouts (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliate_accounts(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  method        public.payout_method not null,

  /* Frozen at request. Phase 1 freezes its fee the same way, and for the same
     reason: the queue shows what will actually land, and an operator changing
     the fee tomorrow does not silently re-price a request made today. */
  amount_minor  bigint not null,
  fee_percent   numeric(6,3) not null,
  fee_minor     bigint not null,
  net_minor     bigint not null,
  currency_code text not null default 'GHS',

  -- Where it goes, as it was at the moment of asking.
  snapshot_provider_code text,
  snapshot_msisdn        text,
  snapshot_account_name  text,
  snapshot_coin_code     text,
  snapshot_network_code  text,
  snapshot_wallet        text,

  /* Crypto is owed in COIN, not in cedis. Quoted once, here, and honoured at
     disbursement whatever the rate has done since. */
  coin_amount numeric(24,8),
  coin_usd    numeric(18,8),
  usd_ghs     numeric(18,8),
  quoted_at   timestamptz,

  status public.commission_payout_status not null default 'requested',

  /* The ledger row this request put the money on hold with. Kept so approving,
     paying and rejecting all act on the same entry rather than searching for
     it by amount and hoping. */
  ledger_entry_id uuid references public.commission_ledger(id),

  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  review_notes  text,
  paid_at       timestamptz,
  external_reference text,
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_payouts_amount_sane check (amount_minor > 0),
  constraint commission_payouts_fee_sane    check (fee_minor >= 0 and fee_minor <= amount_minor),
  constraint commission_payouts_net_sane    check (net_minor = amount_minor - fee_minor),
  constraint commission_payouts_paid_has_time
    check (status <> 'paid' or paid_at is not null),
  constraint commission_payouts_rejected_has_reason
    check (status <> 'rejected' or (review_notes is not null and length(btrim(review_notes)) > 0))
);

comment on table public.commission_payouts is
  'Withdrawals of affiliate commission. Separate queue from points redemptions (D27), same destination details, same fee, same rails.';

create index if not exists commission_payouts_queue_idx
  on public.commission_payouts (status, created_at);
create index if not exists commission_payouts_affiliate_idx
  on public.commission_payouts (affiliate_id, created_at desc);

/* One open request at a time. A queue with three simultaneous requests from
   one person is a queue an operator has to reason about instead of work
   through, and the balance check would have to consider the others anyway. */
create unique index if not exists commission_payouts_one_open_idx
  on public.commission_payouts (affiliate_id)
  where status in ('requested', 'approved');

drop trigger if exists commission_payouts_touch_updated_at on public.commission_payouts;
create trigger commission_payouts_touch_updated_at
  before update on public.commission_payouts
  for each row execute function public.touch_updated_at();

alter table public.commission_payouts enable row level security;

create policy commission_payouts_own on public.commission_payouts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());


-- ---------------------------------------------------------------------------
-- 1. Asking for the money
-- ---------------------------------------------------------------------------

create or replace function public.request_commission_payout(
  p_user_id uuid,
  p_amount_minor bigint
)
returns public.commission_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  public.affiliate_accounts;
  v_details  public.user_payout_details;
  v_balance  bigint;
  v_minimum  bigint;
  v_fee_pct  numeric;
  v_fee      bigint;
  v_cooloff  int;
  v_ledger   uuid;
  v_quote    jsonb;
  v_provider text;
  v_coin     text;
  v_network  text;
  v_row      public.commission_payouts;
begin
  /* H45: off by default, and independent of the points switch, so one business
     can be opened without committing the other. */
  if not coalesce((select value::boolean from public.app_config
                    where key = 'affiliate_payouts_enabled'), false) then
    raise exception 'Commission withdrawals are not open yet'
      using errcode = 'check_violation';
  end if;

  select * into v_account from public.affiliate_accounts where user_id = p_user_id;
  if not found then
    raise exception 'You are not an affiliate' using errcode = 'check_violation';
  end if;
  if v_account.status = 'suspended' then
    raise exception 'This account is suspended' using errcode = 'check_violation';
  end if;

  select * into v_details from public.user_payout_details where user_id = p_user_id;
  if not found then
    raise exception 'Add where to send your money first' using errcode = 'check_violation';
  end if;

  /* The same anti-takeover delay Phase 1 applies to points. Identical threat:
     take over an account, change the destination, withdraw before anybody
     notices. */
  v_cooloff := coalesce(public.config_int('payout_details_change_cooloff_hours'), 48);
  if v_details.last_changed_at > now() - make_interval(hours => v_cooloff) then
    raise exception 'Your payout details were changed recently. Try again in % hours.',
      v_cooloff using errcode = 'check_violation';
  end if;

  v_balance := public.affiliate_balance_minor(v_account.id);

  /* C21. A reversal after a payout can leave somebody owing, and the operator
     chose to block rather than write it off — so this refuses outright rather
     than quietly offering a smaller amount. */
  if v_balance <= 0 then
    raise exception 'You have nothing to withdraw' using errcode = 'check_violation';
  end if;

  v_minimum := coalesce(public.config_int('commission_payout_minimum_minor'), 0);
  if p_amount_minor < v_minimum then
    raise exception 'The least you can withdraw is %',
      to_char(v_minimum / 100.0, 'FM999999990.00') using errcode = 'check_violation';
  end if;

  if p_amount_minor > v_balance then
    raise exception 'You only have %',
      to_char(v_balance / 100.0, 'FM999999990.00') using errcode = 'check_violation';
  end if;

  -- ONE fee for the whole platform, shared with points (operator, 2026-08-06).
  v_fee_pct := coalesce(public.config_decimal('redemption_fee_percent'), 0);
  v_fee     := round(p_amount_minor * v_fee_pct / 100.0);

  if v_details.method = 'mobile_money' then
    select code into v_provider from public.payout_providers where id = v_details.provider_id;
  else
    select c.code, n.code into v_coin, v_network
      from public.payout_coins c
      left join public.payout_networks n on n.id = v_details.network_id
     where c.id = v_details.coin_id;

    /* Quoted and frozen. The coin price moves between asking and paying, and
       Phase 1's locked rule is that whoever asked for 12 USDT receives 12
       USDT — the cedi figure is what varies, not the coin. */
    v_quote := public.quote_crypto_payout((p_amount_minor - v_fee) / 100.0, v_coin);
  end if;

  insert into public.commission_payouts (
    affiliate_id, user_id, method,
    amount_minor, fee_percent, fee_minor, net_minor,
    snapshot_provider_code, snapshot_msisdn, snapshot_account_name,
    snapshot_coin_code, snapshot_network_code, snapshot_wallet,
    coin_amount, coin_usd, usd_ghs, quoted_at
  ) values (
    v_account.id, p_user_id, v_details.method,
    p_amount_minor, v_fee_pct, v_fee, p_amount_minor - v_fee,
    v_provider, v_details.msisdn, v_details.account_name,
    v_coin, v_network, v_details.wallet_address,
    nullif(v_quote ->> 'coin_amount', '')::numeric,
    nullif(v_quote ->> 'coin_usd', '')::numeric,
    nullif(v_quote ->> 'usd_ghs', '')::numeric,
    case when v_quote is not null then now() end
  )
  returning * into v_row;

  /* The money leaves the available balance NOW, not on approval. Three
     requests against one balance is otherwise reachable simply by tapping
     twice before an operator looks. */
  insert into public.commission_ledger
    (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
  values (
    v_account.id, 'payout', -p_amount_minor, 'requested',
    'Withdrawal requested', 'payout:' || v_row.id::text
  )
  returning id into v_ledger;

  update public.commission_payouts set ledger_entry_id = v_ledger where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Deciding
-- ---------------------------------------------------------------------------

create or replace function public.decide_commission_payout(
  p_admin_id uuid,
  p_payout_id uuid,
  p_decision text,          -- 'approve' | 'reject'
  p_note text default null
)
returns public.commission_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.commission_payouts;
  v_email text;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_row from public.commission_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Unknown payout' using errcode = 'check_violation';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'That request is already %', v_row.status using errcode = 'check_violation';
  end if;

  if p_decision = 'reject' then
    if p_note is null or length(btrim(p_note)) = 0 then
      raise exception 'A rejection needs a reason' using errcode = 'check_violation';
    end if;

    update public.commission_payouts
       set status = 'rejected', reviewed_by = p_admin_id, reviewed_at = now(),
           review_notes = p_note
     where id = p_payout_id
    returning * into v_row;

    /* THE MONEY GOES BACK BY REVERSING THE HOLD, not by adding a credit. The
       ledger's own trigger permits a status change and refuses an amount
       change, which is exactly the shape wanted here: one row, one story. A
       compensating credit alongside a still-'requested' payout would count
       twice — migration 116 is the scar. */
    update public.commission_ledger
       set status = 'reversed', reason = 'Withdrawal rejected: ' || p_note, updated_at = now()
     where id = v_row.ledger_entry_id;

  elsif p_decision = 'approve' then
    update public.commission_payouts
       set status = 'approved', reviewed_by = p_admin_id, reviewed_at = now(),
           review_notes = p_note
     where id = p_payout_id
    returning * into v_row;
  else
    raise exception 'Decision must be approve or reject' using errcode = 'check_violation';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, old_values, new_values)
  values (
    p_admin_id, v_email, 'update', 'commission_payouts', p_payout_id,
    jsonb_build_object('status', 'requested'),
    jsonb_build_object('status', v_row.status, 'note', p_note)
  );

  insert into public.notifications (user_id, type, title, body, reference)
  values (
    v_row.user_id, 'payout',
    case when v_row.status = 'approved' then 'Withdrawal approved'
         else 'Withdrawal declined' end,
    case when v_row.status = 'approved'
         then 'Your commission withdrawal is on its way.'
         else coalesce(p_note, 'Your commission withdrawal was declined.') end,
    jsonb_build_object('kind', 'commission_payout', 'payout_id', p_payout_id::text,
                       'status', v_row.status)
  );

  return v_row;
end;
$$;


create or replace function public.mark_commission_payout_paid(
  p_admin_id uuid,
  p_payout_id uuid,
  p_reference text
)
returns public.commission_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.commission_payouts;
  v_email text;
begin
  perform public.assert_admin(p_admin_id);

  select * into v_row from public.commission_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Unknown payout' using errcode = 'check_violation';
  end if;
  if v_row.status = 'paid' then
    return v_row;   -- idempotent; marking twice is not an error
  end if;
  if v_row.status <> 'approved' then
    raise exception 'Only an approved withdrawal can be marked paid'
      using errcode = 'check_violation';
  end if;

  update public.commission_payouts
     set status = 'paid', paid_at = now(), external_reference = p_reference
   where id = p_payout_id
  returning * into v_row;

  /* The hold becomes a payment. The amount never moves — only its state. */
  update public.commission_ledger
     set status = 'paid', updated_at = now()
   where id = v_row.ledger_entry_id;

  select u.email::text into v_email from auth.users u where u.id = p_admin_id;
  insert into public.admin_audit_log
    (actor_id, actor_email, action, entity_type, entity_id, new_values)
  values (p_admin_id, v_email, 'update', 'commission_payouts', p_payout_id,
          jsonb_build_object('status', 'paid', 'reference', p_reference));

  insert into public.notifications (user_id, type, title, body, reference)
  values (
    v_row.user_id, 'payout', 'Withdrawal sent',
    'Your commission has been sent.',
    jsonb_build_object('kind', 'commission_payout', 'payout_id', p_payout_id::text,
                       'status', 'paid')
  );

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. The queue
-- ---------------------------------------------------------------------------
--
-- Destinations are MASKED. An operator deciding a payout needs to recognise a
-- destination, not read it out — the same rule Phase 1's payout queue follows.

create or replace function public.admin_list_commission_payouts(
  p_status text default 'requested'
)
returns table (
  payout_id      uuid,
  requested_at   timestamptz,
  affiliate_id   uuid,
  affiliate_code text,
  name           text,
  method         text,
  amount_minor   bigint,
  fee_minor      bigint,
  net_minor      bigint,
  coin_amount    numeric,
  coin_code      text,
  destination    text,
  balance_after  bigint,
  status         text,
  review_notes   text,
  paid_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.id, cp.created_at, cp.affiliate_id, a.affiliate_code,
         coalesce(p.full_name, '')::text,
         cp.method::text,
         cp.amount_minor, cp.fee_minor, cp.net_minor,
         cp.coin_amount, cp.snapshot_coin_code,
         case cp.method
           when 'mobile_money' then
             coalesce(cp.snapshot_provider_code, '') || ' ' ||
             public.mask_payout_value(cp.snapshot_msisdn)
           else
             coalesce(cp.snapshot_coin_code, '') || ' ' ||
             public.mask_payout_value(cp.snapshot_wallet)
         end,
         public.affiliate_balance_minor(cp.affiliate_id),
         cp.status::text, cp.review_notes, cp.paid_at
    from public.commission_payouts cp
    join public.affiliate_accounts a on a.id = cp.affiliate_id
    join public.profiles p on p.id = cp.user_id
   where p_status is null or cp.status::text = p_status
   order by cp.created_at;
$$;


-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.request_commission_payout(uuid, bigint)',
    'public.decide_commission_payout(uuid, uuid, text, text)',
    'public.mark_commission_payout_paid(uuid, uuid, text)',
    'public.admin_list_commission_payouts(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;
