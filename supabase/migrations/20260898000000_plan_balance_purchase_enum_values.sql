-- ============================================================================
-- Migration 239a: the two enum values a plan bought from the balance needs
--
-- On their own because Postgres will not let a value added by
-- `alter type ... add value` be USED in the same transaction that added it,
-- and migration 239 uses both. Applying this one first is the whole reason it
-- exists.
--
--   subscription_payment_method 'balance'  the payment row says how it was paid
--   ledger_entry_type 'plan_purchase'      the points debit says what it bought
-- ============================================================================

alter type public.subscription_payment_method add value if not exists 'balance';
alter type public.ledger_entry_type add value if not exists 'plan_purchase';

-- Migration 240 (part paid from the balance, part through Paystack) returns
-- the points it set aside when the Paystack half fails or is reversed. Its own
-- ledger type, so a returned hold never reads as new earnings.
alter type public.ledger_entry_type add value if not exists 'plan_purchase_release';
