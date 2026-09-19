-- ============================================================================
-- Migration 234 — the `free_window_buyout` ledger entry type
--
-- Alone in its own migration, for the sixth time in this project:
-- `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it.
--
-- Its own kind rather than `admin_adjustment`, so somebody reading their own
-- statement sees "Free trial" and not "Account correction". That fall-through
-- has now caught surveys, gift codes, game prizes and task rewards in turn,
-- and `LEDGER_KIND` in src/lib/dashboard/home-data.ts needs the matching entry
-- or the same bug arrives a fifth time by a different door.
-- ============================================================================

alter type public.ledger_entry_type add value if not exists 'free_window_buyout';
