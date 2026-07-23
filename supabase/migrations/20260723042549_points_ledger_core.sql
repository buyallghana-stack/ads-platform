-- ============================================================================
-- Migration 006 — Points ledger core
--
-- The money-critical centre of the platform. §6.3 requires a single immutable
-- ledger per user, with ads, surveys and referrals all crediting the same
-- balance — no parallel currencies.
--
-- Shape:
--   points_ledger           append-only truth. Never updated, never deleted.
--   user_balances           derived running balance, one row per user.
--   daily_earning_counters  per-user per-day cap tracking.
--   daily_issuance          platform-wide issuance for the reward-pool guard.
--   system_alerts           where the pool guard raises its hand.
--
-- Why a balance row exists at all: summing an append-only ledger on every read
-- is O(n) and grows forever. A user with 10,000 entries would re-sum 10,000
-- rows on every dashboard load, and §6.10 puts a live balance on screen via
-- Realtime. The ledger stays the source of truth; the balance is a cache
-- updated in the SAME transaction, with a reconciliation function to prove
-- they agree.
--
-- Everything below assumes the client is hostile. No table here has a write
-- policy for any role. The only way points move is through the SECURITY
-- DEFINER functions at the bottom, which are revoked from anon and
-- authenticated and callable only by server-side code.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.ledger_entry_type as enum (
  'ad_view',              -- valid view: watched + answered correctly (§6.2)
  'survey',               -- in-house survey ad
  'referral_signup',      -- stage one of the two-stage referral bonus (§6.8)
  'referral_activation',  -- stage two, once the referee has watched enough ads
  'redemption_request',   -- debit, taken at request time (never at approval)
  'redemption_refund',    -- credit, on rejection or user cancellation
  'admin_adjustment'      -- manual correction, always attributed
);

create type public.alert_severity as enum ('info', 'warning', 'critical');


-- ---------------------------------------------------------------------------
-- points_ledger — append-only
-- ---------------------------------------------------------------------------

create table public.points_ledger (
  id bigint generated always as identity primary key,

  -- CASCADE: deleting a user removes their ledger. The audit log and
  -- redemption records retain what happened; this table is per-user detail.
  user_id uuid not null references auth.users (id) on delete cascade,

  entry_type public.ledger_entry_type not null,

  -- Signed. Positive credits, negative debits. Zero is meaningless and
  -- rejected, so a no-op can never masquerade as a transaction.
  amount bigint not null check (amount <> 0),

  -- Balance immediately after this entry. Redundant with the running sum by
  -- design: it makes any drift between ledger and user_balances visible at the
  -- exact entry where it started, instead of only in the total.
  balance_after bigint not null check (balance_after >= 0),

  -- What caused this entry — an ad id, a redemption id, a referred user id.
  reference_type text,
  reference_id   text,

  -- The peg at the moment of earning. The rate is fixed policy and is not
  -- expected to move, but recording it means a balance can never silently
  -- reprice, and any future change is provably forward-only (§6.4).
  points_per_currency_unit bigint not null check (points_per_currency_unit > 0),

  -- Free-form context: which question was answered, which admin adjusted and
  -- why. Never holds payout details or anything sensitive (§6.4.1).
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.points_ledger is
  'Append-only. UPDATE and DELETE are blocked by trigger for every role including the table owner. Corrections are compensating entries, never edits.';

-- The user's own history view, newest first, paginated (§8).
create index points_ledger_user_created_idx on public.points_ledger (user_id, created_at desc);

-- Idempotency. Crediting the same ad twice is the single easiest way to leak
-- points, whether from a double-submitted form, a retried request or a bug.
-- admin_adjustment is excluded because a legitimate correction may repeat
-- against the same reference.
create unique index points_ledger_source_once_idx
  on public.points_ledger (user_id, entry_type, reference_type, reference_id)
  where reference_id is not null and entry_type <> 'admin_adjustment';

-- Reward-pool accounting and daily reporting scan by day.
create index points_ledger_created_idx on public.points_ledger (created_at);


-- Append-only enforcement.
--
-- RLS alone is not sufficient here: the service key bypasses RLS entirely, and
-- this table must resist a mistake made by our own server code just as much as
-- a hostile client. A BEFORE trigger stops the statement regardless of role.
create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'points_ledger is append-only: % is not permitted. Post a compensating entry instead.', tg_op
    using errcode = 'raise_exception';
end;
$$;

create trigger points_ledger_no_update
  before update on public.points_ledger
  for each row execute function public.prevent_ledger_mutation();

create trigger points_ledger_no_delete
  before delete on public.points_ledger
  for each row execute function public.prevent_ledger_mutation();


-- ---------------------------------------------------------------------------
-- user_balances
-- ---------------------------------------------------------------------------

create table public.user_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,

  balance bigint not null default 0 check (balance >= 0),

  -- Lifetime totals are not derivable from `balance` once redemptions occur,
  -- and the fraud review queue wants "earned a lot, cashed out immediately".
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  lifetime_spent  bigint not null default 0 check (lifetime_spent  >= 0),

  updated_at timestamptz not null default now()
);

comment on table public.user_balances is
  'Derived cache of points_ledger, updated in the same transaction as each entry. Never written directly — see credit_points/debit_points.';


-- ---------------------------------------------------------------------------
-- daily_earning_counters — per-user daily cap (§6.3)
-- ---------------------------------------------------------------------------
--
-- A separate counter rather than counting ledger rows for today. Counting
-- would scan a growing partition of the ledger on every single ad view, which
-- is precisely the hot path §8 calls a release blocker.
--
-- "Cap resets midnight UTC" needs no reset job: a new UTC day simply has no
-- row yet.

create table public.daily_earning_counters (
  user_id uuid not null references auth.users (id) on delete cascade,

  -- UTC calendar day. Explicitly not local time — the cap must reset at the
  -- same instant for everyone.
  day date not null,

  ads_completed int    not null default 0 check (ads_completed >= 0),
  points_earned bigint not null default 0 check (points_earned >= 0),

  -- Supports the cooldown mechanism, which ships built and disabled (§6.3).
  last_earned_at timestamptz,

  primary key (user_id, day)
);

comment on table public.daily_earning_counters is
  'Per-user daily cap state, keyed by UTC day so the reset needs no scheduled job.';


-- ---------------------------------------------------------------------------
-- daily_issuance — reward-pool guard (§6.3 sustainability)
-- ---------------------------------------------------------------------------

create table public.daily_issuance (
  day date primary key,
  points_issued bigint not null default 0 check (points_issued >= 0),

  -- So the alert fires once per day rather than on every subsequent credit.
  ceiling_alerted_at timestamptz,

  updated_at timestamptz not null default now()
);

comment on table public.daily_issuance is
  'Platform-wide points issued per UTC day. Compared against reward_pool_daily_ceiling_points, which is alert-only: earning is never blocked by it.';


-- ---------------------------------------------------------------------------
-- system_alerts
-- ---------------------------------------------------------------------------

create table public.system_alerts (
  id bigint generated always as identity primary key,
  severity public.alert_severity not null,

  -- Stable machine code so the dashboard and any future notifier can route on
  -- it without parsing prose.
  code text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,

  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.system_alerts is
  'Machine-raised operational alerts surfaced in the admin dashboard. Email/Sentry delivery attaches later; the record exists from day one so nothing is lost meanwhile.';

create index system_alerts_open_idx on public.system_alerts (created_at desc)
  where acknowledged_at is null;
create index system_alerts_ack_by_idx on public.system_alerts (acknowledged_by)
  where acknowledged_by is not null;


-- ---------------------------------------------------------------------------
-- UTC day helper
-- ---------------------------------------------------------------------------

create or replace function public.utc_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'utc')::date;
$$;


-- ============================================================================
-- The only ways points move
-- ============================================================================

-- ---------------------------------------------------------------------------
-- credit_points — add points, update balance and daily counters atomically
-- ---------------------------------------------------------------------------
--
-- Concurrency: the balance upsert takes a row lock, so simultaneous credits
-- for one user serialise rather than racing. Everything happens in a single
-- transaction — a failure anywhere leaves no partial state, which is the
-- entire point of doing the counter, the balance and the ledger together.
--
-- p_enforce_daily_cap is false for referral bonuses: those are not ad views
-- and must not consume a user's daily allowance.

create or replace function public.credit_points(
  p_user_id           uuid,
  p_amount            bigint,
  p_entry_type        public.ledger_entry_type,
  p_reference_type    text default null,
  p_reference_id      text default null,
  p_metadata          jsonb default '{}'::jsonb,
  p_enforce_daily_cap boolean default false
)
returns public.points_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier        public.tiers;
  v_rate        bigint;
  v_today       date := public.utc_today();
  v_new_balance bigint;
  v_ceiling     bigint;
  v_issued      bigint;
  v_alerted     timestamptz;
  v_cooldown    int;
  v_counter     public.daily_earning_counters;
  v_existing    public.daily_earning_counters;
  v_entry       public.points_ledger;
begin
  if p_amount <= 0 then
    raise exception 'credit_points requires a positive amount, got %', p_amount;
  end if;

  -- Global kill switch (§6.6). Checked here so every earning path is covered
  -- by construction rather than by remembering to check at each call site.
  if public.config_bool('earning_paused_globally') then
    raise exception 'Earning is paused platform-wide' using errcode = 'check_violation';
  end if;

  v_rate := public.config_int('points_per_currency_unit');

  -- Daily cap, enforced server-side (§6.3). The WHERE on the conflict action
  -- is what makes this safe under concurrency: if the cap is already reached
  -- no row is updated and RETURNING yields nothing, so two simultaneous views
  -- cannot both pass a cap of one.
  if p_enforce_daily_cap then
    v_tier := public.resolve_user_tier(p_user_id);

    if v_tier.daily_ad_cap <= 0 then
      raise exception 'Tier % has a daily cap of zero', v_tier.slug using errcode = 'check_violation';
    end if;

    -- Cooldown ships built and disabled (§6.3): the tier value is 0 at launch
    -- and the config fallback is 0, so this clause never bites until the
    -- operator deliberately sets one. Resolved before the upsert so it can be
    -- enforced inside the same atomic statement as the cap.
    v_cooldown := coalesce(
      nullif(v_tier.ad_cooldown_seconds, 0),
      public.config_int('ad_cooldown_seconds_default')::int
    );

    -- Both the cap and the cooldown are enforced in the conflict action's
    -- WHERE. That is what makes them safe under concurrency: if either fails,
    -- no row is updated and RETURNING yields nothing, so two simultaneous
    -- views cannot both slip past a cap of one.
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

    -- Nothing was written. Re-read to say *which* rule stopped it, because
    -- "cap reached" and "wait 30 seconds" need very different user-facing
    -- messages.
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
  end if;

  -- Balance. ON CONFLICT DO UPDATE locks the row, serialising concurrent
  -- credits for this user.
  insert into public.user_balances (user_id, balance, lifetime_earned, updated_at)
  values (p_user_id, p_amount, p_amount, now())
  on conflict (user_id) do update
    set balance         = public.user_balances.balance + p_amount,
        lifetime_earned = public.user_balances.lifetime_earned + p_amount,
        updated_at      = now()
  returning balance into v_new_balance;

  -- Ledger entry. The unique index on (user, type, reference) makes a repeat
  -- credit for the same source fail here rather than silently duplicating.
  insert into public.points_ledger (
    user_id, entry_type, amount, balance_after,
    reference_type, reference_id, points_per_currency_unit, metadata
  )
  values (
    p_user_id, p_entry_type, p_amount, v_new_balance,
    p_reference_type, p_reference_id, v_rate, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_entry;

  -- Reward-pool guard. Operator decision: alert only, never block (§6.3).
  insert into public.daily_issuance (day, points_issued, updated_at)
  values (v_today, p_amount, now())
  on conflict (day) do update
    set points_issued = public.daily_issuance.points_issued + p_amount,
        updated_at    = now()
  returning points_issued, ceiling_alerted_at into v_issued, v_alerted;

  v_ceiling := public.config_int('reward_pool_daily_ceiling_points');

  -- A ceiling of 0 means unlimited, so there is no threshold to breach and no
  -- alert to raise. Setting any positive value activates this immediately.
  if v_ceiling > 0 and v_issued >= v_ceiling then
    update public.daily_issuance
       set ceiling_alerted_at = now()
     where day = v_today and ceiling_alerted_at is null;

    if found then
      insert into public.system_alerts (severity, code, message, context)
      values (
        'critical',
        'reward_pool_ceiling_exceeded',
        format('Daily points issuance (%s) has reached the configured ceiling (%s). Earning was NOT blocked.',
               v_issued, v_ceiling),
        jsonb_build_object('day', v_today, 'issued', v_issued, 'ceiling', v_ceiling)
      );
    end if;
  end if;

  return v_entry;
end;
$$;


-- ---------------------------------------------------------------------------
-- debit_points — spend points
-- ---------------------------------------------------------------------------
--
-- The balance guard lives in the UPDATE's WHERE clause. Checking the balance
-- and then updating as two statements would let concurrent redemptions both
-- read a sufficient balance and both succeed — the classic double-spend. Here
-- the second one matches no row and raises.

create or replace function public.debit_points(
  p_user_id        uuid,
  p_amount         bigint,
  p_entry_type     public.ledger_entry_type,
  p_reference_type text default null,
  p_reference_id   text default null,
  p_metadata       jsonb default '{}'::jsonb
)
returns public.points_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate        bigint;
  v_new_balance bigint;
  v_entry       public.points_ledger;
begin
  if p_amount <= 0 then
    raise exception 'debit_points requires a positive amount to deduct, got %', p_amount;
  end if;

  v_rate := public.config_int('points_per_currency_unit');

  update public.user_balances
     set balance        = balance - p_amount,
         lifetime_spent = lifetime_spent + p_amount,
         updated_at     = now()
   where user_id = p_user_id
     and balance >= p_amount
  returning balance into v_new_balance;

  if not found then
    raise exception 'Insufficient points balance for debit of %', p_amount
      using errcode = 'check_violation';
  end if;

  insert into public.points_ledger (
    user_id, entry_type, amount, balance_after,
    reference_type, reference_id, points_per_currency_unit, metadata
  )
  values (
    p_user_id, p_entry_type, -p_amount, v_new_balance,
    p_reference_type, p_reference_id, v_rate, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_entry;

  return v_entry;
end;
$$;


-- ---------------------------------------------------------------------------
-- reconcile_user_balance — prove the cache matches the truth
-- ---------------------------------------------------------------------------
--
-- The balance row exists for speed and is therefore the thing that can be
-- wrong. This recomputes from the ledger and reports drift. Intended to run on
-- a schedule across all users and to be available ad hoc during fraud review.
-- It reports; it does not silently repair, because a silent repair would hide
-- the bug that caused the drift.

create or replace function public.reconcile_user_balance(p_user_id uuid)
returns table (
  user_id uuid,
  stored_balance bigint,
  ledger_balance bigint,
  drift bigint,
  entry_count bigint
)
language sql
stable
set search_path = ''
as $$
  select
    p_user_id,
    coalesce(b.balance, 0),
    coalesce(l.total, 0),
    coalesce(b.balance, 0) - coalesce(l.total, 0),
    coalesce(l.cnt, 0)
  from (select 1) _
  left join public.user_balances b on b.user_id = p_user_id
  left join (
    select sum(amount) as total, count(*) as cnt
    from public.points_ledger
    where points_ledger.user_id = p_user_id
  ) l on true;
$$;

comment on function public.reconcile_user_balance(uuid) is
  'Recomputes balance from the ledger and reports drift. Reports only — never repairs, so the underlying bug stays visible.';


-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
--
-- These are SECURITY DEFINER and move money. A signed-in user calling
-- credit_points directly would mint points for themselves, so EXECUTE is
-- revoked from every client-reachable role. Server code uses the secret key,
-- which authenticates as service_role.

revoke execute on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean)
  from public, anon, authenticated;
revoke execute on function public.debit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.prevent_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.reconcile_user_balance(uuid) from public, anon;


-- ============================================================================
-- Row Level Security
--
-- No table below has an INSERT, UPDATE or DELETE policy for any role. Points
-- move only through the functions above.
-- ============================================================================

alter table public.points_ledger          enable row level security;
alter table public.user_balances          enable row level security;
alter table public.daily_earning_counters enable row level security;
alter table public.daily_issuance         enable row level security;
alter table public.system_alerts          enable row level security;

create policy "Read own ledger or all as admin"
  on public.points_ledger for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

create policy "Read own balance or all as admin"
  on public.user_balances for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- Users read their own counter so the UI can show "14 of 20 ads today"
-- without a privileged call.
create policy "Read own counters or all as admin"
  on public.daily_earning_counters for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- Platform-wide issuance tells an attacker how much headroom remains in the
-- reward economy. Admins only.
create policy "Admins read daily issuance"
  on public.daily_issuance for select
  to authenticated
  using (public.is_admin());

create policy "Admins read alerts"
  on public.system_alerts for select
  to authenticated
  using (public.is_admin());

create policy "Admins acknowledge alerts"
  on public.system_alerts for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
