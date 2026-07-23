-- ============================================================================
-- Migration 021 — Referral programme (§6.8)
--
-- Single level, two stages, activity-gated.
--
-- Why single level, structurally
-- -----------------------------
-- There is no ancestry traversal anywhere in this file, and there is no column
-- that could support one. A referrer earns from their own referees and from
-- nobody else's. §6.8 makes this deliberate: multi-level rewards are what give
-- a scheme pyramid characteristics, and they multiply the value of farming
-- accounts. profiles.referred_by exists for attribution and is never walked
-- upward.
--
-- Why two stages
-- --------------
-- A signup bonus alone pays for the act of creating an account, which is
-- exactly what a farm produces cheaply. The activation bonus pays only once
-- the referee has completed a configured number of ads — real activity that
-- costs the farmer real watching time. §6.8 names this two-stage gate as the
-- main anti-farming defence, ahead of fingerprinting.
--
-- The activation qualifier is ads watched only, with no days-active
-- requirement, per §6.8.
--
-- Guardrails the schema enforces:
--   * no pay-to-participate — nothing is charged to refer or be referred
--   * reward follows activity, not signup — stage two is the larger bonus
--   * a user cannot refer themselves, and cannot be referred twice
--   * a code can only be applied by an account that has not yet earned
-- ============================================================================


create type public.referral_status as enum (
  'pending',    -- signed up, activation not yet reached
  'activated',  -- referee met the ad threshold; both bonuses settled
  'rejected'    -- reversed by an admin during fraud review
);


create table public.referrals (
  id uuid primary key default gen_random_uuid(),

  referrer_id uuid not null references auth.users (id) on delete cascade,

  -- One referrer per account, forever. The PK-grade unique constraint is what
  -- stops a user shopping their signup around several referrers.
  referee_id uuid not null unique references auth.users (id) on delete cascade,

  code_used text not null,
  status public.referral_status not null default 'pending',

  -- Amounts are recorded as paid, not looked up later: changing the configured
  -- bonus must not rewrite what someone was already given.
  signup_bonus_points     bigint not null default 0 check (signup_bonus_points >= 0),
  signup_bonus_paid_at    timestamptz,
  activation_bonus_points bigint not null default 0 check (activation_bonus_points >= 0),
  activation_bonus_paid_at timestamptz,

  -- The referee's completed-ad count when activation fired, kept as evidence.
  ads_at_activation int,

  rejected_reason text,
  rejected_by     uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint referrals_no_self check (referrer_id <> referee_id)
);

comment on table public.referrals is
  'Single-level referrals (§6.8). No ancestry column exists, so multi-level payouts are impossible by construction rather than by policy.';

create index referrals_referrer_idx on public.referrals (referrer_id, created_at desc);
create index referrals_status_idx   on public.referrals (status, created_at desc);
create index referrals_rejected_by_idx on public.referrals (rejected_by) where rejected_by is not null;

create trigger referrals_touch_updated_at
  before update on public.referrals
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- apply_referral_code — stage one
-- ---------------------------------------------------------------------------

create or replace function public.apply_referral_code(
  p_referee_id  uuid,
  p_code        text,
  p_ip          inet default null,
  p_fingerprint text default null
)
returns public.referrals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer public.profiles;
  v_referee  public.profiles;
  v_tier     public.tiers;
  v_bonus    bigint;
  v_row      public.referrals;
  v_shared   int;
begin
  select * into v_referee from public.profiles where id = p_referee_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;

  if v_referee.referred_by is not null then
    raise exception 'A referral code has already been applied to this account'
      using errcode = 'check_violation';
  end if;

  -- A code is a signup-time thing. Allowing it later would let established
  -- users retro-attribute themselves to a friend for the bonus.
  if exists (select 1 from public.points_ledger l
              where l.user_id = p_referee_id and l.entry_type in ('ad_view','survey')) then
    raise exception 'Referral codes can only be applied before you start earning'
      using errcode = 'check_violation';
  end if;

  select * into v_referrer from public.profiles
   where referral_code = upper(trim(p_code));
  if not found then
    raise exception 'That referral code is not valid' using errcode = 'check_violation';
  end if;

  if v_referrer.id = p_referee_id then
    raise exception 'You cannot refer yourself' using errcode = 'check_violation';
  end if;

  if v_referrer.disabled_at is not null then
    raise exception 'That referral code is no longer active' using errcode = 'check_violation';
  end if;

  -- Same device or same address as the referrer is the ordinary shape of
  -- self-referral. §6.8 relies on the two-stage gate as the real defence, so
  -- this flags for review rather than refusing — a household sharing a phone
  -- is a legitimate referral.
  v_shared := 0;
  if p_fingerprint is not null then
    select count(*) into v_shared from public.user_devices d
     where d.fingerprint = p_fingerprint and d.user_id = v_referrer.id;
  end if;
  if v_shared = 0 and p_ip is not null then
    select count(*) into v_shared from public.auth_signals s
     where s.ip = p_ip and s.user_id = v_referrer.id;
  end if;

  v_tier  := public.resolve_user_tier(v_referrer.id);
  v_bonus := floor(public.config_int('referral_signup_bonus_points')
                   * v_tier.referral_bonus_multiplier)::bigint;

  insert into public.referrals (referrer_id, referee_id, code_used, signup_bonus_points)
  values (v_referrer.id, p_referee_id, upper(trim(p_code)), v_bonus)
  returning * into v_row;

  update public.profiles set referred_by = v_referrer.id where id = p_referee_id;

  -- A configured bonus of zero means the stage is switched off, so no ledger
  -- entry is created at all rather than a meaningless zero-value row.
  if v_bonus > 0 then
    perform public.credit_points(
      v_referrer.id, v_bonus, 'referral_signup', 'referral', v_row.id::text,
      jsonb_build_object('referee_id', p_referee_id, 'tier_multiplier', v_tier.referral_bonus_multiplier)
    );
    update public.referrals set signup_bonus_paid_at = now() where id = v_row.id
    returning * into v_row;
  end if;

  if v_shared > 0 then
    perform public.record_fraud_signal(p_referee_id, 'self_referral_suspected',
      jsonb_build_object('referrer_id', v_referrer.id,
                         'shared', case when p_fingerprint is not null then 'device' else 'ip' end));
    perform public.record_fraud_signal(v_referrer.id, 'self_referral_suspected',
      jsonb_build_object('referee_id', p_referee_id));
  end if;

  return v_row;
end;
$$;

revoke execute on function public.apply_referral_code(uuid, text, inet, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Stage two — activation, driven by real activity
-- ---------------------------------------------------------------------------
--
-- Fires from the ledger rather than from the earning loop, so any future path
-- that credits an ad view also counts toward activation without needing to
-- remember to call this.

create or replace function public.check_referral_activation(p_referee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref    public.referrals;
  v_needed int;
  v_done   int;
  v_tier   public.tiers;
  v_bonus  bigint;
begin
  select * into v_ref from public.referrals
   where referee_id = p_referee_id and status = 'pending'
   for update;

  if not found then
    return false;
  end if;

  v_needed := public.config_int('referral_activation_ads_required')::int;

  -- Ads watched only. §6.8 explicitly excludes any days-active requirement.
  select count(*) into v_done
    from public.points_ledger l
   where l.user_id = p_referee_id
     and l.entry_type in ('ad_view', 'survey');

  if v_done < v_needed then
    return false;
  end if;

  v_tier  := public.resolve_user_tier(v_ref.referrer_id);
  v_bonus := floor(public.config_int('referral_activation_bonus_points')
                   * v_tier.referral_bonus_multiplier)::bigint;

  if v_bonus > 0 then
    perform public.credit_points(
      v_ref.referrer_id, v_bonus, 'referral_activation', 'referral', v_ref.id::text,
      jsonb_build_object('referee_id', p_referee_id, 'ads_completed', v_done,
                         'tier_multiplier', v_tier.referral_bonus_multiplier)
    );
  end if;

  update public.referrals
     set status = 'activated',
         activation_bonus_points = v_bonus,
         activation_bonus_paid_at = case when v_bonus > 0 then now() end,
         ads_at_activation = v_done,
         updated_at = now()
   where id = v_ref.id;

  return true;
end;
$$;

revoke execute on function public.check_referral_activation(uuid) from public, anon, authenticated;


create or replace function public.referral_activation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only ad activity counts, which also stops the referrer's own bonus credit
  -- from re-entering this path.
  if new.entry_type in ('ad_view', 'survey') then
    perform public.check_referral_activation(new.user_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.referral_activation_trigger() from public, anon, authenticated;

create trigger points_ledger_referral_activation
  after insert on public.points_ledger
  for each row execute function public.referral_activation_trigger();


-- ---------------------------------------------------------------------------
-- reject_referral — admin reversal during fraud review
-- ---------------------------------------------------------------------------
--
-- Claws the bonuses back from the referrer with compensating ledger entries.
-- The referee keeps everything they earned by watching: they may simply have
-- been recruited by someone abusive, and punishing them for that would be
-- wrong.

create or replace function public.reject_referral(
  p_admin_id    uuid,
  p_referral_id uuid,
  p_reason      text
)
returns public.referrals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref   public.referrals;
  v_total bigint;
  v_bal   bigint;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;

  select * into v_ref from public.referrals where id = p_referral_id for update;
  if not found then
    raise exception 'Referral not found' using errcode = 'check_violation';
  end if;
  if v_ref.status = 'rejected' then
    raise exception 'Already rejected' using errcode = 'check_violation';
  end if;

  v_total := coalesce(v_ref.signup_bonus_points, 0) + coalesce(v_ref.activation_bonus_points, 0);

  if v_total > 0 then
    select coalesce(balance, 0) into v_bal from public.user_balances where user_id = v_ref.referrer_id;

    -- Claw back what is actually there. A negative balance is not
    -- representable, and chasing a shortfall through the ledger would be worse
    -- than recording that it could not be fully recovered.
    v_total := least(v_total, coalesce(v_bal, 0));

    if v_total > 0 then
      perform public.debit_points(
        v_ref.referrer_id, v_total, 'admin_adjustment', 'referral_reversal', p_referral_id::text,
        jsonb_build_object('reason', trim(p_reason), 'rejected_by', p_admin_id)
      );
    end if;
  end if;

  update public.referrals
     set status = 'rejected', rejected_reason = trim(p_reason),
         rejected_by = p_admin_id, updated_at = now()
   where id = p_referral_id
  returning * into v_ref;

  return v_ref;
end;
$$;

revoke execute on function public.reject_referral(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- get_referral_summary — what the user's referral screen needs
-- ---------------------------------------------------------------------------

create or replace function public.get_referral_summary(p_user_id uuid)
returns table (
  referral_code    text,
  total_referred   int,
  activated_count  int,
  pending_count    int,
  points_earned    bigint,
  ads_required     int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.referral_code,
    coalesce(r.total, 0)::int,
    coalesce(r.activated, 0)::int,
    coalesce(r.pending, 0)::int,
    coalesce(r.points, 0)::bigint,
    public.config_int('referral_activation_ads_required')::int
  from public.profiles p
  left join (
    select referrer_id,
           count(*) filter (where status <> 'rejected')  as total,
           count(*) filter (where status = 'activated')  as activated,
           count(*) filter (where status = 'pending')    as pending,
           sum(case when status = 'rejected' then 0
                    else signup_bonus_points + activation_bonus_points end) as points
    from public.referrals group by referrer_id
  ) r on r.referrer_id = p.id
  where p.id = p_user_id;
end;
$$;

revoke execute on function public.get_referral_summary(uuid) from public, anon;


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.referrals enable row level security;

-- A referrer sees who they brought in; a referee sees who referred them.
-- Neither can write: bonuses are credited server-side only.
create policy "Read own referrals or all as admin"
  on public.referrals for select
  to authenticated
  using ((select auth.uid()) in (referrer_id, referee_id) or public.is_admin());


-- ============================================================================
-- Fraud check registration
-- ============================================================================

insert into public.fraud_checks (code, name, description, weight, severity, action) values
  ('self_referral_suspected', 'Referrer and referee share a device or address',
   'The referred account signed up from the same device fingerprint or IP as its referrer. Flags rather than blocks — a household sharing a phone is a legitimate referral, and §6.8 relies on the two-stage activation gate as the real defence.',
   35, 'medium', 'flag');
