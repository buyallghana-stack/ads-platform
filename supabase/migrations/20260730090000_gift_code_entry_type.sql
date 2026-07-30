-- ============================================================================
-- Migration 064 — ledger entry type for gift codes
--
-- Its own file for the reason migrations 039 and 060 were split: Postgres
-- refuses to add an enum value and then USE it inside one transaction, and
-- Supabase runs each migration file in a transaction. The value lands here;
-- everything that writes it lands in the next migration.
-- ============================================================================

alter type public.ledger_entry_type add value if not exists 'gift_code';
