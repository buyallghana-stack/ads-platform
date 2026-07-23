-- ============================================================================
-- Migration 001 — Foundation: profiles, roles, audit log
--
-- Establishes identity and the access-control boundary every later module
-- depends on. Deliberately contains no business rules (no tiers, points, ads):
-- those land on top of this, once this is verified.
--
-- Design notes:
--   * Role resolution goes through a JWT claim, not a table lookup. RLS runs on
--     every row of every query; a lookup here would tax the ad-view hot path
--     that §8 names a release blocker.
--   * The audit log exists before the first admin action does, so §2.5
--     attribution is never something we retrofit onto existing behaviour.
--   * Every table below has RLS enabled with explicit policies. A table with
--     RLS on and no policy denies all access, which is the safe failure mode;
--     a table with RLS off is world-readable via the publishable key.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Phase 1 ships User and Admin with equal admin powers (§6.6). The enum exists
-- so a narrower role (support, read-only) can be added later as a value plus
-- policy changes, with no structural rewrite.
create type public.app_role as enum ('user', 'admin');


-- ---------------------------------------------------------------------------
-- profiles — application-level user record, 1:1 with auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  full_name text not null check (length(trim(full_name)) between 2 and 120),

  -- Collected at signup and used for fraud dedup (§6.1, §7). Deliberately NOT
  -- unique: §7 requires duplicates to be *flagged for review*, not hard-blocked,
  -- because early users legitimately share devices and networks. The fraud
  -- scoring service owns that judgement, not a database constraint.
  -- Nullable because auth.users can be created outside our signup form (admin
  -- invite, a future OAuth provider) and a NOT NULL here would make the
  -- creation trigger fail in a way that is hard to diagnose. The signup schema
  -- enforces it at the application boundary.
  phone text,

  -- ISO 3166-1 alpha-2, resolved from IP at signup and then frozen (§6.9).
  -- Stored so geo enforcement survives the user later changing networks, and
  -- so admins have a review signal that does not depend on current IP.
  signup_country text check (signup_country ~ '^[A-Z]{2}$'),

  referral_code text not null unique,

  -- Single-level referrals only (§6.8) — deliberately no ancestry chain, which
  -- is what keeps this from acquiring multi-level/pyramid characteristics.
  -- ON DELETE SET NULL: removing a referrer must not cascade away their
  -- referees' accounts.
  referred_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application user record, 1:1 with auth.users. Phase 1 identity verification is email only; the KYC seam attaches here when licensing requires it (§6.1).';

-- Referral attribution lookups ("who did this user refer?") run on the
-- referral dashboard and during bonus payout. Partial: most rows are NULL.
create index profiles_referred_by_idx on public.profiles (referred_by)
  where referred_by is not null;

-- Fraud dedup scans phone numbers at signup (§7).
create index profiles_phone_idx on public.profiles (phone)
  where phone is not null;

-- Admin user lists sort newest-first and paginate (§8: paginate every list).
create index profiles_created_at_idx on public.profiles (created_at desc);


-- ---------------------------------------------------------------------------
-- user_roles — role grants, separate from profiles
-- ---------------------------------------------------------------------------
--
-- Kept in its own table rather than a column on profiles for two reasons:
--   1. A user editing their own profile must never be one policy mistake away
--      from editing their own role. Different table, different policies.
--   2. Grants are auditable facts (who granted, when), not attributes.

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table public.user_roles is
  'Role grants. Read by the auth hook at token issuance; never queried on the request hot path.';


-- ---------------------------------------------------------------------------
-- Access token hook — puts the role in the JWT
-- ---------------------------------------------------------------------------
--
-- Runs once when a token is issued, not per query. RLS then reads the claim
-- straight from the token: no joins, no recursion, no per-row lookup.
--
-- Trade-off, stated plainly: a role change does not take effect until the
-- user's token refreshes (~1h, or immediately if we force a refresh). For
-- revoking admin access urgently, that lag matters — the kill switches in §6.6
-- are the immediate lever, and they are checked against live data.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims   jsonb;
  resolved public.app_role;
begin
  -- A user may hold several grants; admin wins.
  select ur.role
    into resolved
    from public.user_roles ur
   where ur.user_id = (event ->> 'user_id')::uuid
   order by (ur.role = 'admin') desc
   limit 1;

  claims := event -> 'claims';

  -- Default to the least-privileged role. A user with no grant row is a normal
  -- user, and an absent claim must never read as elevated.
  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(resolved, 'user')::text));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase auth hook: injects user_role into the JWT. Must be enabled in Dashboard > Authentication > Hooks.';

-- The hook executes as supabase_auth_admin, which has no access to our schema
-- by default.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;

-- No one else may call it.
revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;


-- ---------------------------------------------------------------------------
-- Role helpers for policies
-- ---------------------------------------------------------------------------

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'user_role', ''),
    'user'
  )::public.app_role;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.current_app_role() = 'admin';
$$;

comment on function public.is_admin() is
  'Reads the JWT role claim. Pure function of the token — no table access, safe to call from RLS without recursion.';


-- ---------------------------------------------------------------------------
-- admin_audit_log — append-only record of privileged actions (§2.5)
-- ---------------------------------------------------------------------------

create table public.admin_audit_log (
  id bigint generated always as identity primary key,

  -- SET NULL rather than CASCADE: deleting an admin must never erase the
  -- history of what they did. actor_email preserves attribution regardless.
  actor_id    uuid references auth.users (id) on delete set null,
  actor_email text,

  action      text not null,
  entity_type text not null,
  entity_id   text,

  -- Old/new pairs give §2.5's required before-after on config changes.
  old_values jsonb,
  new_values jsonb,

  ip         inet,
  user_agent text,

  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Append-only. No UPDATE or DELETE policy exists for any role, so history cannot be rewritten through the API.';

create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_actor_idx      on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_log_entity_idx     on public.admin_audit_log (entity_type, entity_id);


-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- Referral codes
-- ---------------------------------------------------------------------------

-- Crockford-style alphabet: no I, L, O, U — avoids misreads when a code is
-- spoken aloud or typed from a screenshot, which is how referral codes
-- actually travel.
create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  attempt   int := 0;
begin
  loop
    candidate := '';
    for _ in 1 .. 8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.profiles p where p.referral_code = candidate
    );

    attempt := attempt + 1;
    -- 32^8 ≈ 1.1e12 combinations; repeated collisions mean something is wrong
    -- rather than unlucky, and we would rather fail loudly than spin.
    if attempt >= 10 then
      raise exception 'Could not generate a unique referral code after % attempts', attempt;
    end if;
  end loop;

  return candidate;
end;
$$;


-- ---------------------------------------------------------------------------
-- Signup trigger — profile + default role
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER because it writes rows the new user has no rights to yet.
-- Kept minimal for that reason: it must never depend on caller-supplied values
-- beyond the metadata Supabase already validated.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, signup_country, referral_code)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Unnamed user'),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    upper(nullif(trim(new.raw_user_meta_data ->> 'signup_country'), '')),
    public.generate_referral_code()
  );

  -- Every account starts as a plain user. Admin is only ever granted
  -- explicitly, and that grant is auditable.
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- Row Level Security
--
-- Enabled on every table. Note that RLS does not apply to the secret key used
-- by the admin client — that is exactly why admin.ts is guarded by
-- `server-only` and why its call sites need justifying.
-- ============================================================================

alter table public.profiles        enable row level security;
alter table public.user_roles      enable row level security;
alter table public.admin_audit_log enable row level security;


-- profiles ------------------------------------------------------------------

create policy "Users read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Admins read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- Note there is deliberately no INSERT policy: profiles are created solely by
-- the signup trigger. A user cannot manufacture one.
create policy "Users update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Admins update any profile"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- user_roles ----------------------------------------------------------------

create policy "Users read own roles"
  on public.user_roles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Admins read all roles"
  on public.user_roles for select
  to authenticated
  using (public.is_admin());

-- No INSERT/UPDATE/DELETE policy for anyone, including admins. Granting a role
-- is a privileged server-side operation that must pass through the audited
-- admin path, never a direct client write. This is the single most
-- security-sensitive table in the schema: a self-INSERT here is a total
-- privilege escalation.


-- admin_audit_log -----------------------------------------------------------

create policy "Admins read audit log"
  on public.admin_audit_log for select
  to authenticated
  using (public.is_admin());

-- No INSERT policy: entries are written server-side with the secret key, so a
-- client cannot forge history. No UPDATE or DELETE policy for any role, which
-- is what makes the log append-only rather than merely append-mostly.
