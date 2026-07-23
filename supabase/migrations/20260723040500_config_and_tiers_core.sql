-- ============================================================================
-- Migration 004 — Config and tiers core
--
-- The layer every later module reads its numbers from. §2.1 requires that
-- reward rates, caps, thresholds, conversion rate, tier perks, referral
-- bonuses, cooldowns and budgets are all editable without a deploy, so none of
-- them may exist as a constant in application code.
--
-- Two stores, deliberately separate:
--   app_config  — platform-wide scalars ("what is the retry cap?")
--   tiers       — per-tier perks ("what is *this* tier's daily cap?")
--
-- Money is stored as integer minor units (pesewas), never floating point.
-- 0.1 + 0.2 != 0.3 in binary floating point, and that error compounds across a
-- ledger. Point *rates* use numeric, which is arbitrary-precision decimal.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- app_config — platform-wide settings
-- ---------------------------------------------------------------------------
--
-- Key/value rather than one column per setting, because §2.1's "never needs a
-- code deploy" has to include *adding* a setting. The cost is that the shape of
-- a value is not enforced by the column type, so each row carries its own
-- validation metadata and a CHECK enforces it.

create type public.config_value_type as enum ('int', 'decimal', 'bool', 'text');

create table public.app_config (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value       text not null,
  value_type  public.config_value_type not null,

  -- Bounds are advisory metadata for the admin UI *and* enforced below, so a
  -- fat-fingered reward rate cannot be saved through any path.
  min_value   numeric,
  max_value   numeric,

  description text not null,

  -- Whether unauthenticated/ordinary users may read this row. The
  -- points-to-currency rate must be public (§6.10 shows live value to users);
  -- the reward-pool ceiling must not be, since it tells an attacker exactly
  -- how much the economy can be drained for.
  is_public   boolean not null default false,

  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),

  -- Values are stored as text so one column can hold every type; these checks
  -- keep them parseable and in range.
  constraint app_config_value_wellformed check (
    case value_type
      when 'int'     then value ~ '^-?\d+$'
      when 'decimal' then value ~ '^-?\d+(\.\d+)?$'
      when 'bool'    then value in ('true', 'false')
      when 'text'    then true
    end
  ),
  constraint app_config_value_in_range check (
    value_type not in ('int', 'decimal')
    or (
      (min_value is null or value::numeric >= min_value)
      and (max_value is null or value::numeric <= max_value)
    )
  )
);

comment on table public.app_config is
  'Platform-wide settings, admin-editable without deploy (§2.1). Read through the cached config service, never queried per-request on the ad-view hot path.';


-- ---------------------------------------------------------------------------
-- tiers — subscription tiers and their perks
-- ---------------------------------------------------------------------------
--
-- §6.7: tier *count* is admin-configurable, so tiers are rows, not an enum and
-- not a hardcoded free/pro branch. Nothing downstream may ask "is this the free
-- tier?" — it asks "what is this tier's daily_ad_cap?".

create table public.tiers (
  id uuid primary key default gen_random_uuid(),

  -- Stable machine identifier. Exists so seed data and tests can refer to a
  -- tier without pinning a generated UUID; business logic must still read
  -- perks from columns rather than branching on this value.
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_-]*$'),

  name        text not null check (length(trim(name)) between 1 and 60),
  description text,

  -- Minor units (pesewas). 0 for the free tier.
  price_minor    bigint not null default 0 check (price_minor >= 0),
  currency_code  char(3) not null default 'GHS',

  -- §6.7: billing period is configurable, not fixed monthly/yearly.
  billing_period_days int not null default 30 check (billing_period_days between 1 and 3650),

  -- --- Perks (§6.7: each tier configures all of them) ---------------------

  -- §6.3: daily cap is a number of ads per day and varies by tier.
  daily_ad_cap int not null check (daily_ad_cap >= 0),

  -- Multiplies the per-ad points set by the admin on each ad (§6.2).
  reward_multiplier numeric(6, 3) not null default 1.000
    check (reward_multiplier > 0 and reward_multiplier <= 100),

  -- §6.4: better tier = lower minimum. Same across payout methods.
  redemption_minimum_points bigint not null check (redemption_minimum_points >= 0),

  -- §6.8: referral bonuses can be boosted per tier.
  referral_bonus_multiplier numeric(6, 3) not null default 1.000
    check (referral_bonus_multiplier > 0 and referral_bonus_multiplier <= 100),

  -- §6.7: priority ad access. Higher wins when the serving strategy ranks
  -- eligible users; 0 means no priority.
  ad_priority int not null default 0 check (ad_priority >= 0),

  -- §6.3: cooldown ships built but disabled. Zero = no wait between ads.
  ad_cooldown_seconds int not null default 0 check (ad_cooldown_seconds >= 0),

  -- --- Lifecycle ----------------------------------------------------------

  -- The tier assigned to every new user and the target of auto-downgrade on
  -- expiry (§6.7). Must be free and must be active.
  is_default boolean not null default false,
  is_active  boolean not null default true,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tiers_default_is_free   check (not is_default or price_minor = 0),
  constraint tiers_default_is_active check (not is_default or is_active)
);

comment on table public.tiers is
  'Subscription tiers as data (§6.7). No code may branch on a specific tier; read the perk columns instead.';

-- At most one default tier. Postgres cannot declaratively require *at least*
-- one, so the seed below creates it and delete of the default is blocked by
-- the guard trigger further down.
create unique index tiers_single_default_idx on public.tiers (is_default) where is_default;

-- Tier lists render in admin and on the pricing page, both ordered.
create index tiers_active_sort_idx on public.tiers (is_active, sort_order) where is_active;


-- ---------------------------------------------------------------------------
-- user_subscriptions — which tier a user currently holds
-- ---------------------------------------------------------------------------
--
-- Included here rather than with billing (§9 step 7) because tier *resolution*
-- is meaningless without it, and the alternative — a tier_id column on
-- profiles — would have to be torn out once expiry and grace periods arrive.
-- Payment records, invoices and renewal handling are still step 7; this table
-- holds only the state that tier resolution needs.

create type public.subscription_status as enum ('active', 'grace', 'expired', 'cancelled');

create table public.user_subscriptions (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- RESTRICT: a tier with subscribers must not vanish underneath them.
  -- Deactivate it instead — same principle as payout options in §6.4.1.
  tier_id uuid not null references public.tiers (id) on delete restrict,

  status public.subscription_status not null default 'active',

  started_at         timestamptz not null default now(),
  current_period_end timestamptz not null,

  -- §6.7: grace period before auto-downgrade to the default tier.
  grace_ends_at timestamptz,

  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscription_grace_after_period
    check (grace_ends_at is null or grace_ends_at >= current_period_end)
);

comment on table public.user_subscriptions is
  'Current tier holding per user. Absence of an active row means the user is on the default tier — new users get no row at all.';

-- A user may hold only one non-terminal subscription at a time.
create unique index user_subscriptions_one_live_idx
  on public.user_subscriptions (user_id)
  where status in ('active', 'grace');

-- The expiry sweep scans by period end.
create index user_subscriptions_expiry_idx
  on public.user_subscriptions (current_period_end)
  where status in ('active', 'grace');


-- ---------------------------------------------------------------------------
-- Tier resolution
-- ---------------------------------------------------------------------------
--
-- ⚠ §6.7 raises this explicitly: every subsystem reads tier data, so this must
-- not become a per-ad-view database round trip. One indexed lookup with a
-- fallback is the floor; the application caches the tier table and calls this
-- only when it needs authoritative state (earning, redemption).
--
-- Grace counts as still holding the tier — that is what a grace period is.

create or replace function public.resolve_user_tier(p_user_id uuid)
returns public.tiers
language plpgsql
stable
set search_path = ''
as $$
declare
  result public.tiers;
begin
  -- Live subscription wins. The partial unique index guarantees at most one
  -- row in ('active','grace') per user, so this cannot be ambiguous.
  select t.* into result
    from public.user_subscriptions s
    join public.tiers t on t.id = s.tier_id
   where s.user_id = p_user_id
     and s.status in ('active', 'grace')
     and (s.grace_ends_at is null or now() < s.grace_ends_at)
   limit 1;

  if found then
    return result;
  end if;

  -- No live subscription: the default tier. Guaranteed to exist by
  -- protect_default_tier().
  select t.* into result from public.tiers t where t.is_default limit 1;
  return result;
end;
$$;

comment on function public.resolve_user_tier(uuid) is
  'Authoritative current tier for a user, falling back to the default tier. Grace period still counts as holding the tier.';


-- ---------------------------------------------------------------------------
-- Typed config accessors
-- ---------------------------------------------------------------------------
--
-- Raise rather than return null on a missing key. A silently-null reward rate
-- or cap would read as zero somewhere downstream, and on this platform that
-- means either paying nothing or paying without limit.

create or replace function public.config_int(p_key text)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare v text;
begin
  select c.value into v from public.app_config c where c.key = p_key and c.value_type = 'int';
  if v is null then
    raise exception 'Missing or non-int config key: %', p_key using errcode = 'no_data_found';
  end if;
  return v::bigint;
end;
$$;

create or replace function public.config_decimal(p_key text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare v text;
begin
  select c.value into v from public.app_config c
   where c.key = p_key and c.value_type in ('decimal', 'int');
  if v is null then
    raise exception 'Missing or non-numeric config key: %', p_key using errcode = 'no_data_found';
  end if;
  return v::numeric;
end;
$$;

create or replace function public.config_bool(p_key text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare v text;
begin
  select c.value into v from public.app_config c where c.key = p_key and c.value_type = 'bool';
  if v is null then
    raise exception 'Missing or non-bool config key: %', p_key using errcode = 'no_data_found';
  end if;
  return v = 'true';
end;
$$;


-- ---------------------------------------------------------------------------
-- Automatic audit of config and tier changes (§2.5)
-- ---------------------------------------------------------------------------
--
-- Done as a trigger rather than in application code so that it cannot be
-- forgotten at a call site, and so a change made directly against the database
-- is recorded too. TG_ARGV[0] names the identifying column.
--
-- SECURITY DEFINER because admin_audit_log has no INSERT policy for anyone;
-- writes are meant to originate here or from the server, never from a client.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec        jsonb;
  actor      uuid := auth.uid();
  actor_mail text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if actor is not null then
    select u.email into actor_mail from auth.users u where u.id = actor;
  end if;

  insert into public.admin_audit_log (
    actor_id, actor_email, action, entity_type, entity_id, old_values, new_values
  )
  values (
    actor,
    actor_mail,
    lower(tg_op),
    tg_table_name,
    rec ->> tg_argv[0],
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

create trigger app_config_audit
  after insert or update or delete on public.app_config
  for each row execute function public.audit_row_change('key');

create trigger tiers_audit
  after insert or update or delete on public.tiers
  for each row execute function public.audit_row_change('id');

-- Stamp updated_by/updated_at on config edits so the row itself shows
-- provenance, not only the log.
create or replace function public.stamp_config_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke execute on function public.stamp_config_actor() from public, anon, authenticated;

create trigger app_config_stamp
  before update on public.app_config
  for each row execute function public.stamp_config_actor();

create trigger tiers_touch_updated_at
  before update on public.tiers
  for each row execute function public.touch_updated_at();

create trigger user_subscriptions_touch_updated_at
  before update on public.user_subscriptions
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- Guard: the default tier must always exist
-- ---------------------------------------------------------------------------
--
-- Without a default tier, resolve_user_tier() returns nothing and every new
-- signup has no caps, no redemption minimum and no reward multiplier. Blocking
-- the delete is far better than discovering that at runtime.

create or replace function public.protect_default_tier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.is_default then
    raise exception 'Cannot delete the default tier. Mark another tier default first.';
  end if;

  if tg_op = 'UPDATE' and old.is_default and not new.is_default then
    if not exists (select 1 from public.tiers t where t.is_default and t.id <> old.id) then
      raise exception 'Cannot unset the only default tier. Promote another tier first.';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.protect_default_tier() from public, anon, authenticated;

create trigger tiers_protect_default
  before update or delete on public.tiers
  for each row execute function public.protect_default_tier();


-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.app_config         enable row level security;
alter table public.tiers              enable row level security;
alter table public.user_subscriptions enable row level security;


-- app_config ----------------------------------------------------------------

-- Public keys are readable without signing in: the pricing page shows the
-- conversion rate before a visitor has an account.
create policy "Anyone reads public config"
  on public.app_config for select
  to anon, authenticated
  using (is_public);

create policy "Admins read all config"
  on public.app_config for select
  to authenticated
  using (public.is_admin());

-- Admins may edit values through the dashboard; every change is audited by the
-- trigger above. INSERT and DELETE are deliberately omitted: adding or removing
-- a config *key* changes what the code expects to find and belongs in a
-- migration, not a form.
create policy "Admins update config values"
  on public.app_config for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- tiers ---------------------------------------------------------------------

create policy "Anyone reads active tiers"
  on public.tiers for select
  to anon, authenticated
  using (is_active);

create policy "Admins read all tiers"
  on public.tiers for select
  to authenticated
  using (public.is_admin());

create policy "Admins insert tiers"
  on public.tiers for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins update tiers"
  on public.tiers for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete tiers"
  on public.tiers for delete
  to authenticated
  using (public.is_admin());


-- user_subscriptions --------------------------------------------------------

create policy "Users read own subscription"
  on public.user_subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Admins read all subscriptions"
  on public.user_subscriptions for select
  to authenticated
  using (public.is_admin());

-- No client write policy. Subscriptions change only as a result of a verified
-- payment or the expiry sweep, both server-side. A user who could INSERT here
-- would grant themselves a paid tier for free.


-- ============================================================================
-- Seed
-- ============================================================================

-- Only the free tier is seeded. Paid tiers are the operator's pricing
-- decision (§6.7 makes tier count configurable), and inventing prices here
-- would be exactly the generic filler §0 warns against.
insert into public.tiers (
  slug, name, description,
  price_minor, billing_period_days,
  daily_ad_cap, reward_multiplier,
  redemption_minimum_points, referral_bonus_multiplier,
  ad_priority, ad_cooldown_seconds,
  is_default, is_active, sort_order
)
values (
  'free', 'Free', 'Default tier for every new account.',
  0, 30,
  20, 1.000,
  5000, 1.000,
  0, 0,
  true, true, 0
);

-- Platform-wide settings. Every value here is a starting point the operator
-- can change in the dashboard without a deploy; none is load-bearing in code.
insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description) values
  ('currency_code', 'GHS', 'text', null, null, true,
   'ISO 4217 currency for display and payouts. Ghana only (§6.9).'),

  ('points_per_currency_unit', '1000', 'int', 1, null, true,
   'Points required for one major currency unit (1 GHS). Applied at redemption using the current rate; changes are forward-only and never claw back earned points (§6.4).'),

  ('ad_retry_cap', '3', 'int', 1, 10, true,
   'Attempts allowed per ad before it is failed and locked for that user (§6.2).'),

  ('ad_cooldown_seconds_default', '0', 'int', 0, 86400, false,
   'Fallback cooldown when a tier does not set one. Built but disabled at launch (§6.3).'),

  ('redemption_holding_hours', '72', 'int', 0, 8760, true,
   'Fraud-catch window between redemption request and finalisation (§6.4).'),

  ('payout_details_change_cooloff_hours', '48', 'int', 0, 8760, false,
   'Delay before redeeming after payout details change. Changing details immediately before cashing out is a classic takeover pattern (§6.4.1).'),

  ('referral_signup_bonus_points', '0', 'int', 0, null, true,
   'Stage-one referral bonus, credited when a referee signs up. Zero until the operator sets it (§6.8).'),

  ('referral_activation_bonus_points', '0', 'int', 0, null, true,
   'Stage-two referral bonus, credited once the referee watches the required number of ads (§6.8).'),

  ('referral_activation_ads_required', '5', 'int', 1, 1000, true,
   'Ads a referee must complete for the referrer to earn the activation bonus. Activity-based, not signup-based, by design (§6.8).'),

  ('reward_pool_daily_ceiling_points', '0', 'int', 0, null, false,
   'Maximum points the platform will issue per day across all users. Zero means unlimited — set before launch (§6.3 sustainability guard).'),

  ('subscription_grace_period_days', '3', 'int', 0, 365, true,
   'Days a lapsed subscriber keeps tier perks before auto-downgrade to the default tier (§6.7).'),

  ('earning_paused_globally', 'false', 'bool', null, null, false,
   'Platform-wide kill switch for earning. Per-user and per-ad switches are separate (§6.6).');
