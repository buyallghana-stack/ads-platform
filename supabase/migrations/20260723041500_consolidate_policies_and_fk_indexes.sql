-- ============================================================================
-- Migration 005 — Consolidate RLS policies, index foreign keys
--
-- Raised by the performance advisor after 004. Two distinct issues.
--
-- 1. Multiple permissive policies.
--    Migration 001 and 004 expressed "a user sees their own row" and "an admin
--    sees every row" as two separate SELECT policies. Postgres evaluates every
--    permissive policy for the role on every query and ORs the results, so
--    each read paid for both. Merging them into one policy with an explicit OR
--    is behaviourally identical and halves the per-row policy work.
--
--    §8 names the ad-view path a release blocker and says to watch RLS cost.
--    Nothing here reads more or less than before; it just reads it once.
--
-- 2. Unindexed foreign keys.
--    user_subscriptions.tier_id is joined by resolve_user_tier() on the hot
--    path. The other two are lower traffic but still matter: without a
--    covering index, deleting a row from auth.users forces a sequential scan
--    of the referencing table to enforce the constraint.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy "Users read own profile"    on public.profiles;
drop policy "Admins read all profiles"  on public.profiles;

create policy "Read own profile or any as admin"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id or public.is_admin());

drop policy "Users update own profile"  on public.profiles;
drop policy "Admins update any profile" on public.profiles;

create policy "Update own profile or any as admin"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id or public.is_admin())
  with check ((select auth.uid()) = id or public.is_admin());


-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------
-- The supabase_auth_admin policy from migration 003 is left untouched: it
-- targets a different role, so it does not stack with these.

drop policy "Users read own roles"  on public.user_roles;
drop policy "Admins read all roles" on public.user_roles;

create policy "Read own roles or all as admin"
  on public.user_roles for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());


-- ---------------------------------------------------------------------------
-- app_config
-- ---------------------------------------------------------------------------
-- Single policy covering both roles. is_admin() reads the JWT claim and
-- returns false when there is no token, so anon correctly sees public rows
-- only.

drop policy "Anyone reads public config" on public.app_config;
drop policy "Admins read all config"     on public.app_config;

create policy "Read public config, or all as admin"
  on public.app_config for select
  to anon, authenticated
  using (is_public or public.is_admin());


-- ---------------------------------------------------------------------------
-- tiers
-- ---------------------------------------------------------------------------

drop policy "Anyone reads active tiers" on public.tiers;
drop policy "Admins read all tiers"     on public.tiers;

create policy "Read active tiers, or all as admin"
  on public.tiers for select
  to anon, authenticated
  using (is_active or public.is_admin());


-- ---------------------------------------------------------------------------
-- user_subscriptions
-- ---------------------------------------------------------------------------

drop policy "Users read own subscription"   on public.user_subscriptions;
drop policy "Admins read all subscriptions" on public.user_subscriptions;

create policy "Read own subscription or all as admin"
  on public.user_subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());


-- ---------------------------------------------------------------------------
-- Foreign key covering indexes
-- ---------------------------------------------------------------------------

-- Joined by resolve_user_tier(); also makes "how many subscribers on this
-- tier?" cheap in the admin dashboard.
create index user_subscriptions_tier_id_idx on public.user_subscriptions (tier_id);

-- Low traffic, but both are referenced from auth.users. Without these, each
-- user deletion scans the whole referencing table.
create index app_config_updated_by_idx on public.app_config (updated_by)
  where updated_by is not null;

create index user_roles_granted_by_idx on public.user_roles (granted_by)
  where granted_by is not null;
