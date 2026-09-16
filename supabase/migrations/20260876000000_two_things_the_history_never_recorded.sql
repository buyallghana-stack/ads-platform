-- ============================================================================
-- Migration 228 — two things production had that no migration created
--
-- Found by building a database from the migration history for the first time
-- and diffing it against production. 65 tables, 643 columns, 53 triggers, 91
-- policies and 46 enums matched exactly. Three things did not, and both causes
-- are the same: somebody changed production by hand and the history never
-- learned about it.
--
-- 1. `subscription_payment_method` is created as ('korapay', 'crypto') by
--    20260723060000 and NO migration ever adds 'paystack'. Production has it
--    because it was added by hand. Every plan purchase records that value, so
--    a database rebuilt from these files could not take a payment at all, and
--    nobody would find out until the first checkout.
--
-- 2. `purchase_vault_with_balance` exists on production in TWO forms: the
--    (p_plan_id, p_user_id) one the migrations create, and a leftover
--    (p_plan_id) one they do not. The application calls it with both
--    arguments, so the extra overload is dead.
--
--    ⚠️ Dead is not harmless here. PostgREST picks an overload by ARGUMENT
--    NAMES, and supabase-js drops keys whose value is `undefined`. A call that
--    ever lost its user id would not fail; it would quietly resolve to the
--    one-argument version instead, in a function that moves money out of a
--    balance. Removing it closes that door.
--
-- Each statement is a no-op on the database that already has the right shape,
-- so this converges production and a freshly built database onto the same one.
-- ============================================================================

alter type public.subscription_payment_method add value if not exists 'paystack';

drop function if exists public.purchase_vault_with_balance(uuid);
