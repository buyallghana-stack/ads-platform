-- ============================================================================
-- Migration 007 — User deletion policy and account disable
--
-- Found while cleaning up ledger tests: deleting an auth.users row failed with
--
--   points_ledger is append-only: DELETE is not permitted
--
-- raised from inside a cascade, several tables deep. Two correct rules
-- collided — "ledger entries are immutable" and "deleting a user removes their
-- rows" — and the collision surfaced as a confusing runtime error rather than
-- an intelligible constraint.
--
-- The resolution is not to weaken the ledger. For a platform that will move
-- real money under a licence, financial history is exactly the thing that must
-- survive account changes: it is the evidence for what was paid and why, and
-- deleting it on request would destroy the audit trail §2.5 exists to keep.
--
-- So: a user holding ledger history cannot be hard-deleted, and the foreign
-- key now says so directly. Accounts are *disabled* instead, which §6.6
-- already requires as a kill switch.
--
-- Note what stays CASCADE: user_balances and daily_earning_counters are
-- derived caches, not records. A user who signed up and never earned has no
-- ledger rows, so their deletion still works cleanly and takes the derived
-- rows with it. Only genuine financial history blocks deletion.
--
-- Legitimate hard deletion (test fixtures, a regulator-ordered erasure) remains
-- possible for the table owner:
--
--   alter table public.points_ledger disable trigger points_ledger_no_delete;
--   delete from auth.users where id = '...';
--   alter table public.points_ledger enable  trigger points_ledger_no_delete;
--
-- That is deliberately awkward. It requires owner privileges, it cannot be
-- reached through the API by any role, and it will not happen by accident.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Ledger no longer cascades from user deletion
-- ---------------------------------------------------------------------------

alter table public.points_ledger
  drop constraint points_ledger_user_id_fkey;

alter table public.points_ledger
  add constraint points_ledger_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;

comment on constraint points_ledger_user_id_fkey on public.points_ledger is
  'RESTRICT, not CASCADE: a user with financial history cannot be deleted. Disable the account instead (profiles.disabled_at).';


-- ---------------------------------------------------------------------------
-- Account disable (§6.6 kill switches)
-- ---------------------------------------------------------------------------
--
-- The supported alternative to deletion, and the per-user counterpart to the
-- platform-wide earning_paused_globally switch.

alter table public.profiles
  add column disabled_at     timestamptz,
  add column disabled_reason text,
  add column disabled_by     uuid references auth.users (id) on delete set null;

comment on column public.profiles.disabled_at is
  'Non-null means the account is disabled: it cannot earn. Set by an admin; the change is captured in admin_audit_log.';

-- Admin review lists filter to disabled accounts; partial since most are null.
create index profiles_disabled_idx on public.profiles (disabled_at)
  where disabled_at is not null;

create index profiles_disabled_by_idx on public.profiles (disabled_by)
  where disabled_by is not null;

-- profiles was not previously audited. Disabling an account is a privileged
-- action with real consequences for a user, so it belongs in the same trail as
-- config and tier changes.
create trigger profiles_audit
  after update or delete on public.profiles
  for each row execute function public.audit_row_change('id');


-- ---------------------------------------------------------------------------
-- credit_points: refuse to credit a disabled account
-- ---------------------------------------------------------------------------
--
-- Enforced inside the function rather than at each call site, so every present
-- and future earning path inherits it by construction.
--
-- Scope is earning only. Refunds must still reach a disabled user: an account
-- disabled while a redemption is in flight must not have its points swallowed
-- when that redemption is rejected. Admin adjustments likewise stay available,
-- since correcting a disabled account is a normal part of fraud review.

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
  v_disabled    timestamptz;
  v_counter     public.daily_earning_counters;
  v_existing    public.daily_earning_counters;
  v_entry       public.points_ledger;
begin
  if p_amount <= 0 then
    raise exception 'credit_points requires a positive amount, got %', p_amount;
  end if;

  -- Per-account kill switch (§6.6). Earning types only — see note above.
  if p_entry_type in ('ad_view', 'survey', 'referral_signup', 'referral_activation') then
    select p.disabled_at into v_disabled from public.profiles p where p.id = p_user_id;
    if v_disabled is not null then
      raise exception 'Account is disabled and cannot earn' using errcode = 'check_violation';
    end if;
  end if;

  -- Platform-wide kill switch (§6.6).
  if public.config_bool('earning_paused_globally') then
    raise exception 'Earning is paused platform-wide' using errcode = 'check_violation';
  end if;

  v_rate := public.config_int('points_per_currency_unit');

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
        format('Daily points issuance (%s) has reached the configured ceiling (%s). Earning was NOT blocked.',
               v_issued, v_ceiling),
        jsonb_build_object('day', v_today, 'issued', v_issued, 'ceiling', v_ceiling)
      );
    end if;
  end if;

  return v_entry;
end;
$$;

revoke execute on function public.credit_points(uuid, bigint, public.ledger_entry_type, text, text, jsonb, boolean)
  from public, anon, authenticated;
