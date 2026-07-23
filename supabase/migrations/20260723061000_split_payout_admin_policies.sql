-- ============================================================================
-- Migration 022 — Split the payout-option admin policies
--
-- Migration 017 gave each payout-option table an admin policy declared FOR
-- ALL. FOR ALL includes SELECT, so admins ended up with two permissive SELECT
-- policies per table and Postgres evaluated both on every read. Same problem
-- migration 005 fixed elsewhere; I reintroduced it by reaching for FOR ALL as
-- a shorthand.
--
-- The read policies already handle admins — `is_active or public.is_admin()` —
-- so the write policies only ever needed INSERT, UPDATE and DELETE.
-- ============================================================================

drop policy "Admins write coins"     on public.payout_coins;
drop policy "Admins write networks"  on public.payout_coin_networks;
drop policy "Admins write providers" on public.payout_providers;

create policy "Admins insert coins" on public.payout_coins
  for insert to authenticated with check (public.is_admin());
create policy "Admins update coins" on public.payout_coins
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete coins" on public.payout_coins
  for delete to authenticated using (public.is_admin());

create policy "Admins insert networks" on public.payout_coin_networks
  for insert to authenticated with check (public.is_admin());
create policy "Admins update networks" on public.payout_coin_networks
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete networks" on public.payout_coin_networks
  for delete to authenticated using (public.is_admin());

create policy "Admins insert providers" on public.payout_providers
  for insert to authenticated with check (public.is_admin());
create policy "Admins update providers" on public.payout_providers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete providers" on public.payout_providers
  for delete to authenticated using (public.is_admin());
