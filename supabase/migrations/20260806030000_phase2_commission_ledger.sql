-- ============================================================================
-- Migration 114 — PHASE 2, step 6a of 7: the commission ledger (TABLE ONLY)
--
-- Real money, in minor units of GHS. Kept rigorously separate from Phase 1's
-- `points_ledger`, which holds points: two currencies, two ledgers, two
-- withdrawal queues (D27), and no view anywhere that adds one to the other.
--
-- The calculation, clearance and reversal FUNCTIONS are gate G4 and are not in
-- this migration. This is the structure they will write into.
--
-- ---------------------------------------------------------------------------
-- BALANCE IS DERIVED, NEVER STORED
--
-- There is no `balance` column on an affiliate, and that is deliberate. A
-- stored balance is a second source of truth that drifts the first time an
-- update fails halfway, and the drift is invisible until somebody withdraws
-- money they do not have. Every figure comes from summing this table, and the
-- reconciliation script in step 7 proves the sum against conversions and
-- payouts.
--
-- SIGNS ARE PART OF THE MODEL. Credits are positive; reversals and payouts are
-- negative. That means a balance is one `sum()` with no CASE expression, and a
-- new entry type cannot silently be counted the wrong way round.
-- ============================================================================

do $$ begin
  create type public.commission_entry_type as enum ('credit', 'reversal', 'payout', 'adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  /* The lifecycle from brief §4.4. C19 set the hold to zero, so `pending`
     lasts no time at all today — but the state stays, because that is what
     makes the hold a setting the Owner can turn on later rather than a
     migration through money code. */
  create type public.commission_status as enum
    ('pending', 'cleared', 'requested', 'paid', 'reversed');
exception when duplicate_object then null; end $$;


create table if not exists public.commission_ledger (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliate_accounts(id) on delete cascade,

  /* Set on credits and reversals, null on payouts and manual adjustments. */
  conversion_id uuid references public.conversions(id),
  level         int,

  entry_type    public.commission_entry_type not null,
  amount_minor  bigint not null,
  currency_code text not null default 'GHS',
  status        public.commission_status not null default 'pending',

  /* When a pending credit becomes spendable. Null once it has. */
  clears_at     timestamptz,

  reason     text,
  created_by uuid references auth.users(id),

  /* THE GUARD AGAINST PAYING TWICE. Every writer must supply a key derived
     from what it is paying for — the same shape Phase 1 uses for referral
     commissions, and the reason a retried Paystack webhook cannot pay a second
     time even if it slips past the order-level check. */
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_level_sane check (level is null or level in (1, 2)),

  /* A credit is always FOR something, and always positive. */
  constraint commission_credit_shape
    check (entry_type <> 'credit'
           or (conversion_id is not null and level is not null and amount_minor > 0)),

  /* A reversal and a payout both take money away. Storing them positive and
     subtracting in a query is how a balance ends up wrong in one place and
     right in another. */
  constraint commission_reversal_negative
    check (entry_type <> 'reversal' or amount_minor < 0),
  constraint commission_payout_negative
    check (entry_type <> 'payout' or amount_minor < 0),

  /* A manual adjustment is somebody overriding the system by hand. It does not
     happen without a written reason. */
  constraint commission_adjustment_reason
    check (entry_type <> 'adjustment' or (reason is not null and length(btrim(reason)) > 0))
);

comment on table public.commission_ledger is
  'Real money owed to affiliates, in GHS minor units. Separate from points_ledger in every way. Balance is derived by summing this table; there is deliberately no balance column.';

/* ONE CREDIT PER CONVERSION PER LEVEL, ever. The second of the two idempotency
   guards, and the one that survives a caller inventing a fresh key. */
create unique index if not exists commission_credit_once_idx
  on public.commission_ledger (conversion_id, level)
  where entry_type = 'credit';

create index if not exists commission_affiliate_idx
  on public.commission_ledger (affiliate_id, created_at desc);
create index if not exists commission_status_idx
  on public.commission_ledger (status, clears_at)
  where status = 'pending';
create index if not exists commission_conversion_idx
  on public.commission_ledger (conversion_id) where conversion_id is not null;

drop trigger if exists commission_ledger_touch_updated_at on public.commission_ledger;
create trigger commission_ledger_touch_updated_at
  before update on public.commission_ledger
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- Money cannot be edited, only added to
-- ---------------------------------------------------------------------------
--
-- Not fully append-only, because the lifecycle genuinely needs the status to
-- move: pending → cleared → requested → paid. What must never move is the
-- MONEY — the amount, who it belongs to, what it was for, and the key that
-- stops it being paid twice.
--
-- Phase 1's `points_ledger` forbids updates outright. This is the same
-- intention shaped to a row that has a lifecycle: a narrow, enumerated set of
-- columns may change, and every other edit is refused.

create or replace function public.commission_ledger_immutable_money()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.affiliate_id    is distinct from old.affiliate_id
     or new.conversion_id is distinct from old.conversion_id
     or new.level         is distinct from old.level
     or new.entry_type    is distinct from old.entry_type
     or new.amount_minor  is distinct from old.amount_minor
     or new.currency_code is distinct from old.currency_code
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'A commission entry cannot be rewritten — add a reversal instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists commission_ledger_no_rewrite on public.commission_ledger;
create trigger commission_ledger_no_rewrite
  before update on public.commission_ledger
  for each row execute function public.commission_ledger_immutable_money();

create or replace function public.commission_ledger_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A commission entry cannot be deleted' using errcode = 'check_violation';
end;
$$;

drop trigger if exists commission_ledger_no_delete on public.commission_ledger;
create trigger commission_ledger_no_delete
  before delete on public.commission_ledger
  for each row execute function public.commission_ledger_no_delete();


alter table public.commission_ledger enable row level security;

create policy commission_ledger_own on public.commission_ledger
  for select to authenticated
  using (
    exists (select 1 from public.affiliate_accounts a
             where a.id = commission_ledger.affiliate_id
               and (a.user_id = (select auth.uid()) or public.is_admin()))
  );


-- ---------------------------------------------------------------------------
-- What somebody actually has
-- ---------------------------------------------------------------------------
--
-- Two numbers, and an affiliate needs to see both: what they can withdraw, and
-- what is still on its way. Showing only the first makes a commission look
-- like it never arrived; showing only the total makes them try to withdraw
-- money that is not theirs yet.
--
-- Both are a single `sum()` because the signs are in the data.

create or replace function public.affiliate_balance_minor(p_affiliate_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_minor), 0)::bigint
    from public.commission_ledger
   where affiliate_id = p_affiliate_id
     and status in ('cleared', 'requested', 'paid');
$$;

comment on function public.affiliate_balance_minor(uuid) is
  'Withdrawable balance. Requested and paid payouts are already negative rows, so they are included rather than subtracted — one sum, no CASE.';

create or replace function public.affiliate_pending_minor(p_affiliate_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_minor), 0)::bigint
    from public.commission_ledger
   where affiliate_id = p_affiliate_id
     and status = 'pending';
$$;

comment on function public.affiliate_pending_minor(uuid) is
  'Earned but not yet clearable. Zero while the hold period is zero (C19), and the reason the dashboard can show a commission the moment a sale happens.';

revoke execute on function public.affiliate_balance_minor(uuid) from public, anon;
revoke execute on function public.affiliate_pending_minor(uuid) from public, anon;
grant execute on function public.affiliate_balance_minor(uuid) to authenticated, service_role;
grant execute on function public.affiliate_pending_minor(uuid) to authenticated, service_role;
