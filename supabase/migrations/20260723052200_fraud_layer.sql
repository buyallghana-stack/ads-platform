-- ============================================================================
-- Migration 014 — Fraud and abuse layer
--
-- §7's strategy in one line: no single free signal is decisive, so combine
-- them into a score and concentrate enforcement at the payout chokepoint.
-- Multi-accounting costs the business nothing while someone is only watching
-- ads; it costs at cash-out, and redemption is already manual and
-- licence-gated.
--
-- The rule that shapes everything here: FLAG, DO NOT BLOCK. Early users share
-- campus wifi, share phones, and sign up from the same internet café. Blocking
-- a real user is a worse outcome than reviewing a fake one, and it is
-- invisible — they simply never come back. Only two checks block outright
-- (disposable email and known VPN/datacenter ranges), and both are operator-
-- tunable to flag-only without a deploy.
--
-- Checks are DATA, not code branches (§2.1, and §7's "modular, swappable"
-- requirement). Each lives in fraud_checks with its own weight, severity and
-- action. Tuning a weight, disabling a noisy check, or adding a new one is a
-- dashboard edit. Upgrading a check to a paid provider later means changing
-- what writes its signal, not touching the scorer.
--
-- Privacy: this schema holds IP addresses and device fingerprints, which are
-- personal data. Every table below is admin-read-only — users cannot see their
-- own risk score, because telling someone their score is telling an attacker
-- which of their tricks worked.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.risk_level as enum ('low', 'medium', 'high', 'critical');

create type public.fraud_action as enum (
  'flag',   -- record the signal, raise the score, let the action proceed
  'block'   -- refuse the action outright
);

create type public.fraud_review_status as enum (
  'none',            -- never surfaced
  'pending',         -- in the review queue
  'cleared',         -- reviewed, legitimate
  'confirmed_fraud'  -- reviewed, account is abusive
);

create type public.auth_event_type as enum (
  'signup',
  'login',
  'redemption_request',
  'payout_details_change'
);


-- ---------------------------------------------------------------------------
-- fraud_checks — the registry
-- ---------------------------------------------------------------------------
--
-- One row per check. Adding a check to this table does not make it run; the
-- code that produces its signal must exist. What the table controls is whether
-- an existing check is enabled, how much it contributes, and whether it blocks.

create table public.fraud_checks (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),

  name        text not null,
  description text not null,

  is_enabled boolean not null default true,

  -- Contribution to the risk score. Deliberately signed: a future check that
  -- lowers risk (verified phone, long clean history) fits without a redesign.
  weight int not null default 10,

  severity public.risk_level not null default 'medium',
  action   public.fraud_action not null default 'flag',

  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.fraud_checks is
  'Check registry. Weights, severity and flag-vs-block are admin-editable without a deploy (§7 modular and swappable).';


-- ---------------------------------------------------------------------------
-- auth_signals — raw observations
-- ---------------------------------------------------------------------------
--
-- The evidence the velocity and multi-account checks read. Written at signup,
-- login, redemption request and payout-detail change — the four moments worth
-- correlating.

create table public.auth_signals (
  id bigint generated always as identity primary key,

  -- SET NULL rather than CASCADE: the signal that fifty accounts came from one
  -- IP must survive those accounts being removed, or the evidence disappears
  -- exactly when it matters.
  user_id uuid references auth.users (id) on delete set null,

  event_type public.auth_event_type not null,

  ip          inet,
  fingerprint text,
  user_agent  text,
  country     text check (country is null or country ~ '^[A-Z]{2}$'),

  created_at timestamptz not null default now()
);

comment on table public.auth_signals is
  'Raw signup/login/redemption observations. Feeds IP velocity and device correlation. Contains personal data — admin read only.';

create index auth_signals_ip_created_idx on public.auth_signals (ip, created_at desc)
  where ip is not null;
create index auth_signals_fp_created_idx on public.auth_signals (fingerprint, created_at desc)
  where fingerprint is not null;
create index auth_signals_user_idx on public.auth_signals (user_id, created_at desc)
  where user_id is not null;


-- ---------------------------------------------------------------------------
-- user_devices — fingerprint to account mapping
-- ---------------------------------------------------------------------------
--
-- ThumbmarkJS is roughly 80% accurate (§7 chose it over FingerprintJS OSS at
-- 40-60%). That is good enough to correlate and nowhere near good enough to
-- accuse — another reason this feeds a score rather than a block.

create table public.user_devices (
  user_id     uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    int not null default 1 check (seen_count > 0),

  primary key (user_id, fingerprint)
);

comment on table public.user_devices is
  'Device fingerprints per account. One fingerprint across many accounts is the multi-account signal — flagged for review, never auto-blocked (§7).';

-- "How many accounts has this device touched?" — the multi-account check.
create index user_devices_fingerprint_idx on public.user_devices (fingerprint);


-- ---------------------------------------------------------------------------
-- fraud_signals — recorded hits
-- ---------------------------------------------------------------------------

create table public.fraud_signals (
  id bigint generated always as identity primary key,

  user_id    uuid not null references auth.users (id) on delete cascade,
  check_code text not null references public.fraud_checks (code) on delete restrict,

  -- The weight at the moment it fired. Kept here rather than joined at read
  -- time so that re-tuning a check's weight does not silently rewrite the
  -- history of past scores.
  score_delta int not null,

  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.fraud_signals is
  'Individual check hits. score_delta is frozen at fire time so re-tuning a weight does not retroactively rewrite past scores.';

create index fraud_signals_user_created_idx on public.fraud_signals (user_id, created_at desc);
create index fraud_signals_check_idx on public.fraud_signals (check_code, created_at desc);


-- ---------------------------------------------------------------------------
-- user_risk_scores — current standing and review state
-- ---------------------------------------------------------------------------

create table public.user_risk_scores (
  user_id uuid primary key references auth.users (id) on delete cascade,

  score        int not null default 0,
  level        public.risk_level not null default 'low',
  signal_count int not null default 0,

  review_status public.fraud_review_status not null default 'none',
  reviewed_by   uuid references auth.users (id) on delete set null,
  reviewed_at   timestamptz,
  review_notes  text,

  last_computed_at timestamptz not null default now()
);

comment on table public.user_risk_scores is
  'Current risk standing per user. Recomputed from fraud_signals within the decay window; never edited directly except for review fields.';

-- The fraud review queue: highest risk first.
create index user_risk_scores_queue_idx on public.user_risk_scores (score desc)
  where review_status in ('none', 'pending');
create index user_risk_scores_level_idx on public.user_risk_scores (level, score desc);
create index user_risk_scores_reviewer_idx on public.user_risk_scores (reviewed_by)
  where reviewed_by is not null;


-- ---------------------------------------------------------------------------
-- Blocklists — updatable data, not constants
-- ---------------------------------------------------------------------------

create table public.blocked_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  source text,
  added_at timestamptz not null default now()
);

comment on table public.blocked_email_domains is
  'Disposable-email domains (§7). Kept updatable so a refreshed free blocklist is an import, not a deploy.';

create table public.blocked_ip_ranges (
  cidr cidr primary key,
  category text not null default 'vpn',  -- vpn | datacenter | tor | manual
  source text,
  added_at timestamptz not null default now()
);

comment on table public.blocked_ip_ranges is
  'VPN/proxy/datacenter ranges (§7). Free lists are weak; this is upgradeable to a paid signal by changing what populates the table.';

-- inet <<= cidr cannot use a btree index; gist gives containment lookups.
create index blocked_ip_ranges_gist on public.blocked_ip_ranges using gist (cidr inet_ops);


-- ============================================================================
-- Check implementations
--
-- Each is a small, independent function. The scorer calls them; none calls
-- another. That is what makes a check replaceable — swapping the VPN check for
-- a paid API means rewriting one function body.
-- ============================================================================

create or replace function public.fraud_is_email_domain_blocked(p_email text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocked_email_domains d
    where d.domain = lower(split_part(p_email, '@', 2))
  );
$$;

create or replace function public.fraud_is_ip_blocked(p_ip inet)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_ip is not null and exists (
    select 1 from public.blocked_ip_ranges r where p_ip <<= r.cidr
  );
$$;

-- How many OTHER accounts share this phone number. §7 wants duplicates
-- flagged, and leaves reject-vs-flag to the operator — hence a count rather
-- than a boolean verdict.
create or replace function public.fraud_phone_duplicate_count(p_phone text, p_exclude uuid default null)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.profiles p
  where p.phone is not null
    and p_phone is not null
    and p.phone = p_phone
    and (p_exclude is null or p.id <> p_exclude);
$$;

-- New accounts from one IP inside the window. Never blocks: a shared IP is
-- normal in Ghana, where a whole hall of residence can sit behind one address.
create or replace function public.fraud_ip_signup_velocity(p_ip inet, p_window_hours int)
returns int
language sql
stable
set search_path = ''
as $$
  select count(distinct s.user_id)::int
  from public.auth_signals s
  where s.ip = p_ip
    and s.event_type = 'signup'
    and s.created_at >= now() - make_interval(hours => p_window_hours);
$$;

create or replace function public.fraud_fingerprint_account_count(p_fingerprint text, p_exclude uuid default null)
returns int
language sql
stable
set search_path = ''
as $$
  select count(distinct d.user_id)::int
  from public.user_devices d
  where d.fingerprint = p_fingerprint
    and (p_exclude is null or d.user_id <> p_exclude);
$$;


-- ============================================================================
-- Scoring
-- ============================================================================

-- Recomputes from signals inside the decay window. Signals older than the
-- window stop counting: an account flagged once six months ago and clean since
-- should not sit in the queue forever, and a permanent score would fill the
-- review list with noise until nobody reads it.
create or replace function public.recompute_user_risk(p_user_id uuid)
returns public.user_risk_scores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window int := public.config_int('fraud_signal_decay_days')::int;
  v_med    int := public.config_int('fraud_threshold_medium')::int;
  v_high   int := public.config_int('fraud_threshold_high')::int;
  v_crit   int := public.config_int('fraud_threshold_critical')::int;
  v_score  int;
  v_count  int;
  v_level  public.risk_level;
  v_row    public.user_risk_scores;
begin
  select coalesce(sum(s.score_delta), 0)::int, count(*)::int
    into v_score, v_count
    from public.fraud_signals s
   where s.user_id = p_user_id
     and (v_window <= 0 or s.created_at >= now() - make_interval(days => v_window));

  v_level := case
    when v_score >= v_crit then 'critical'
    when v_score >= v_high then 'high'
    when v_score >= v_med  then 'medium'
    else 'low'
  end::public.risk_level;

  insert into public.user_risk_scores (user_id, score, level, signal_count, last_computed_at)
  values (p_user_id, v_score, v_level, v_count, now())
  on conflict (user_id) do update
    set score            = excluded.score,
        level            = excluded.level,
        signal_count     = excluded.signal_count,
        last_computed_at = now(),
        -- Rising into high risk after a clear puts the account back in the
        -- queue. Without this, one clearance is permanent immunity.
        review_status    = case
          when public.user_risk_scores.review_status = 'confirmed_fraud'
            then 'confirmed_fraud'
          when excluded.level in ('high', 'critical')
               and public.user_risk_scores.review_status in ('none', 'cleared')
            then 'pending'
          else public.user_risk_scores.review_status
        end
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.recompute_user_risk(uuid) is
  'Recomputes risk from signals inside the decay window and re-queues accounts that rise into high risk after being cleared.';


-- Records one check hit. No-op when the check is disabled or unknown, so
-- turning a check off in the dashboard genuinely stops it contributing.
create or replace function public.record_fraud_signal(
  p_user_id    uuid,
  p_check_code text,
  p_details    jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.fraud_checks;
begin
  select * into v_check from public.fraud_checks c where c.code = p_check_code;

  if not found or not v_check.is_enabled then
    return false;
  end if;

  insert into public.fraud_signals (user_id, check_code, score_delta, details)
  values (p_user_id, p_check_code, v_check.weight, coalesce(p_details, '{}'::jsonb));

  perform public.recompute_user_risk(p_user_id);
  return true;
end;
$$;

revoke execute on function public.record_fraud_signal(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.recompute_user_risk(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- evaluate_signup_fraud — the checks that run at account creation
-- ---------------------------------------------------------------------------
--
-- Returns whether to allow the signup and why. The caller records the auth
-- signal first so velocity sees this attempt.

create type public.fraud_decision as (
  allowed       boolean,
  block_reason  text,
  score         int,
  level         public.risk_level,
  signals_fired text[]
);

create or replace function public.evaluate_signup_fraud(
  p_user_id     uuid,
  p_email       text,
  p_phone       text,
  p_ip          inet,
  p_fingerprint text
)
returns public.fraud_decision
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fired   text[] := '{}';
  v_blocked text := null;
  v_count   int;
  v_action  public.fraud_action;
  v_risk    public.user_risk_scores;
begin
  -- Disposable email
  if public.fraud_is_email_domain_blocked(p_email) then
    if public.record_fraud_signal(p_user_id, 'disposable_email',
         jsonb_build_object('domain', lower(split_part(p_email, '@', 2)))) then
      v_fired := v_fired || 'disposable_email';
      select action into v_action from public.fraud_checks where code = 'disposable_email';
      if v_action = 'block' then
        v_blocked := 'This email provider is not accepted. Please use a permanent address.';
      end if;
    end if;
  end if;

  -- VPN / proxy / datacenter
  if v_blocked is null and public.fraud_is_ip_blocked(p_ip) then
    if public.record_fraud_signal(p_user_id, 'vpn_or_proxy',
         jsonb_build_object('ip', host(p_ip))) then
      v_fired := v_fired || 'vpn_or_proxy';
      select action into v_action from public.fraud_checks where code = 'vpn_or_proxy';
      if v_action = 'block' then
        v_blocked := 'Please disable your VPN or proxy and try again.';
      end if;
    end if;
  end if;

  -- Duplicate phone. Flag by default: families and shared handsets are real.
  v_count := public.fraud_phone_duplicate_count(p_phone, p_user_id);
  if v_count > 0 then
    if public.record_fraud_signal(p_user_id, 'duplicate_phone',
         jsonb_build_object('other_accounts', v_count)) then
      v_fired := v_fired || 'duplicate_phone';
      select action into v_action from public.fraud_checks where code = 'duplicate_phone';
      if v_action = 'block' and v_blocked is null then
        v_blocked := 'This phone number is already registered.';
      end if;
    end if;
  end if;

  -- Signup burst from one IP. Never blocks — see the note at the top.
  v_count := public.fraud_ip_signup_velocity(p_ip, public.config_int('fraud_ip_velocity_window_hours')::int);
  if v_count > public.config_int('fraud_ip_velocity_max_signups')::int then
    if public.record_fraud_signal(p_user_id, 'ip_signup_velocity',
         jsonb_build_object('ip', host(p_ip), 'signups_in_window', v_count)) then
      v_fired := v_fired || 'ip_signup_velocity';
    end if;
  end if;

  -- One device, several accounts.
  if p_fingerprint is not null then
    v_count := public.fraud_fingerprint_account_count(p_fingerprint, p_user_id);
    if v_count >= public.config_int('fraud_fingerprint_max_accounts')::int then
      if public.record_fraud_signal(p_user_id, 'device_multi_account',
           jsonb_build_object('other_accounts', v_count)) then
        v_fired := v_fired || 'device_multi_account';
      end if;
    end if;
  end if;

  select * into v_risk from public.user_risk_scores where user_id = p_user_id;

  return row(
    v_blocked is null,
    v_blocked,
    coalesce(v_risk.score, 0),
    coalesce(v_risk.level, 'low'::public.risk_level),
    v_fired
  )::public.fraud_decision;
end;
$$;

revoke execute on function public.evaluate_signup_fraud(uuid, text, text, inet, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- record_auth_signal — observation + device bookkeeping
-- ---------------------------------------------------------------------------

create or replace function public.record_auth_signal(
  p_user_id     uuid,
  p_event_type  public.auth_event_type,
  p_ip          inet default null,
  p_fingerprint text default null,
  p_user_agent  text default null,
  p_country     text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.auth_signals (user_id, event_type, ip, fingerprint, user_agent, country)
  values (p_user_id, p_event_type, p_ip, p_fingerprint, p_user_agent, upper(nullif(trim(p_country), '')))
  returning id into v_id;

  if p_user_id is not null and p_fingerprint is not null then
    insert into public.user_devices (user_id, fingerprint)
    values (p_user_id, p_fingerprint)
    on conflict (user_id, fingerprint) do update
      set last_seen_at = now(),
          seen_count   = public.user_devices.seen_count + 1;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.record_auth_signal(uuid, public.auth_event_type, inet, text, text, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Signals raised from elsewhere in the platform
-- ---------------------------------------------------------------------------
--
-- §6.2: repeated ad failures feed the risk score. A trigger keeps it automatic
-- rather than relying on the earning loop to remember.

create or replace function public.flag_repeated_ad_failures()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window int := 24;
  v_limit  int;
  v_fails  int;
begin
  if new.is_correct then
    return new;
  end if;

  v_limit := public.config_int('fraud_ad_failures_threshold')::int;
  if v_limit <= 0 then
    return new;
  end if;

  select count(*) into v_fails
    from public.ad_attempts a
   where a.user_id = new.user_id
     and not a.is_correct
     and a.created_at >= now() - make_interval(hours => v_window);

  -- Fires exactly on crossing, not on every failure after it, so one bad day
  -- does not pile up a dozen identical signals.
  if v_fails = v_limit then
    perform public.record_fraud_signal(new.user_id, 'repeated_ad_failures',
      jsonb_build_object('failures_24h', v_fails));
  end if;

  return new;
end;
$$;

revoke execute on function public.flag_repeated_ad_failures() from public, anon, authenticated;

create trigger ad_attempts_fraud_signal
  after insert on public.ad_attempts
  for each row execute function public.flag_repeated_ad_failures();


-- ============================================================================
-- Row Level Security
--
-- Admin-only throughout. A user must not learn their own risk score: telling
-- someone they were flagged tells an attacker which technique was detected.
-- ============================================================================

alter table public.fraud_checks          enable row level security;
alter table public.auth_signals          enable row level security;
alter table public.user_devices          enable row level security;
alter table public.fraud_signals         enable row level security;
alter table public.user_risk_scores      enable row level security;
alter table public.blocked_email_domains enable row level security;
alter table public.blocked_ip_ranges     enable row level security;

create policy "Admins read fraud checks"   on public.fraud_checks     for select to authenticated using (public.is_admin());
create policy "Admins update fraud checks" on public.fraud_checks     for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Admins read auth signals"   on public.auth_signals     for select to authenticated using (public.is_admin());
create policy "Admins read user devices"   on public.user_devices     for select to authenticated using (public.is_admin());
create policy "Admins read fraud signals"  on public.fraud_signals    for select to authenticated using (public.is_admin());

create policy "Admins read risk scores"    on public.user_risk_scores for select to authenticated using (public.is_admin());
-- Review outcome is the one thing an admin edits by hand.
create policy "Admins review risk scores"  on public.user_risk_scores for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Admins read email blocklist"   on public.blocked_email_domains for select to authenticated using (public.is_admin());
create policy "Admins insert email blocklist" on public.blocked_email_domains for insert to authenticated with check (public.is_admin());
create policy "Admins delete email blocklist" on public.blocked_email_domains for delete to authenticated using (public.is_admin());

create policy "Admins read ip blocklist"   on public.blocked_ip_ranges for select to authenticated using (public.is_admin());
create policy "Admins insert ip blocklist" on public.blocked_ip_ranges for insert to authenticated with check (public.is_admin());
create policy "Admins delete ip blocklist" on public.blocked_ip_ranges for delete to authenticated using (public.is_admin());


-- Audit fraud-check tuning: changing a weight or flipping a check to
-- flag-only is a security-relevant decision and belongs in the trail (§2.5).
create trigger fraud_checks_audit
  after insert or update or delete on public.fraud_checks
  for each row execute function public.audit_row_change('code');

create trigger user_risk_scores_audit
  after update on public.user_risk_scores
  for each row execute function public.audit_row_change('user_id');


-- ============================================================================
-- Seed
-- ============================================================================

insert into public.fraud_checks (code, name, description, weight, severity, action) values
  ('disposable_email', 'Disposable email domain',
   'Signup used a throwaway email provider. Blocks by default: there is no legitimate reason to use one on a platform that pays out money.',
   40, 'high', 'block'),

  ('vpn_or_proxy', 'VPN, proxy or datacenter IP',
   'Connection came from a known VPN, proxy or hosting range. Blocks by default, and reinforces the Ghana-only geo restriction (§6.9), which a VPN would otherwise defeat.',
   35, 'high', 'block'),

  ('duplicate_phone', 'Phone number already registered',
   'Another account uses this number. Flags rather than blocks: shared handsets and family numbers are common.',
   30, 'medium', 'flag'),

  ('ip_signup_velocity', 'Signup burst from one IP',
   'Several new accounts from one address in a short window. Never blocks — a hall of residence or internet cafe shares one address.',
   25, 'medium', 'flag'),

  ('device_multi_account', 'One device, several accounts',
   'This device fingerprint appears on multiple accounts. Fingerprinting is ~80% accurate, which is enough to correlate and not enough to accuse.',
   30, 'medium', 'flag'),

  ('repeated_ad_failures', 'Repeated failed attention questions',
   'Many wrong answers in 24 hours. Consistent with automation guessing, or with a user who cannot read the questions — hence flag, not block.',
   20, 'medium', 'flag'),

  ('payout_details_changed_recently', 'Payout details changed just before redemption',
   'Classic account-takeover and farming pattern (§6.4.1): change where the money goes, then immediately cash out.',
   45, 'high', 'flag'),

  ('rapid_redemption_after_signup', 'Redeemed very soon after signing up',
   'A brand new account reaching the redemption minimum unusually fast suggests farming rather than genuine use.',
   25, 'medium', 'flag');


insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description) values
  ('fraud_threshold_medium', '30', 'int', 1, null, false,
   'Risk score at which an account is rated medium.'),
  ('fraud_threshold_high', '60', 'int', 1, null, false,
   'Risk score at which an account is rated high and enters the review queue.'),
  ('fraud_threshold_critical', '100', 'int', 1, null, false,
   'Risk score at which an account is rated critical.'),
  ('fraud_signal_decay_days', '90', 'int', 0, 3650, false,
   'Signals older than this stop counting. Zero disables decay. Without decay the review queue fills with stale flags until nobody reads it.'),
  ('fraud_ip_velocity_window_hours', '24', 'int', 1, 720, false,
   'Window for counting new signups from one IP.'),
  ('fraud_ip_velocity_max_signups', '5', 'int', 1, 1000, false,
   'Signups from one IP within the window before flagging. Set generously — shared connections are normal in Ghana.'),
  ('fraud_fingerprint_max_accounts', '2', 'int', 1, 100, false,
   'Existing accounts on one device fingerprint before flagging.'),
  ('fraud_ad_failures_threshold', '15', 'int', 0, 1000, false,
   'Failed attention questions in 24h before flagging. Zero disables the check.');


-- A starter disposable-email list. Deliberately short: this is seed data, not
-- a maintained blocklist. §7 wants it kept updatable, so importing a fuller
-- free list is an insert, not a deploy.
insert into public.blocked_email_domains (domain, source) values
  ('mailinator.com', 'seed'),
  ('guerrillamail.com', 'seed'),
  ('10minutemail.com', 'seed'),
  ('tempmail.com', 'seed'),
  ('temp-mail.org', 'seed'),
  ('throwawaymail.com', 'seed'),
  ('yopmail.com', 'seed'),
  ('sharklasers.com', 'seed'),
  ('trashmail.com', 'seed'),
  ('getnada.com', 'seed'),
  ('dispostable.com', 'seed'),
  ('maildrop.cc', 'seed'),
  ('fakeinbox.com', 'seed'),
  ('mohmal.com', 'seed'),
  ('emailondeck.com', 'seed');
