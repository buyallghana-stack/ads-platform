-- ============================================================================
-- Migration 193 — a maintenance screen, with a way in for the people working
--
-- Operator, 2026-09-23: hold the member app closed while the walkthrough is
-- still being changed under it, without locking out the account being tested
-- with or the administrator doing the testing.
--
-- ⚠️ THE ALLOW LIST IS NOT OPTIONAL, AND IT IS WHY THIS IS TWO KEYS RATHER
-- THAN ONE. A maintenance switch that admits nobody is a switch an operator
-- cannot turn off from a phone, because turning it off means reaching the
-- admin, which is behind the same door. Staff always pass, by role rather than
-- by a list anybody has to remember to update.
--
-- The second key exists for the accounts that are NOT staff: the throwaway
-- being tested with. Emails rather than ids because that is what an operator
-- has in front of them at the moment they need it.
-- ============================================================================

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('maintenance_enabled', 'false', 'bool', null, null, false,
   'Closes the member app and shows a maintenance screen instead. Staff always pass, as do any addresses in maintenance_allow_emails. The admin area is never closed by this, or there would be no way to switch it back off.'),
  ('maintenance_allow_emails', '', 'text', null, null, false,
   'Comma separated addresses that may use the app normally while maintenance is on, for a test account that is not staff. Case is ignored and spaces are trimmed.')
on conflict (key) do nothing;
