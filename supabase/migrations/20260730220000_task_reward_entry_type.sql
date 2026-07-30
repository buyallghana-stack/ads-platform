-- ============================================================================
-- Migration 077 — the `task_reward` ledger entry type
--
-- Alone in its own migration, for the fifth time in this project:
-- `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it.
--
-- Its own kind rather than `admin_adjustment`, so a user's history can say
-- "Task reward" instead of "Account correction" — the fall-through that has
-- now caught surveys, gift codes and game prizes in turn.
-- ============================================================================

alter type public.ledger_entry_type add value if not exists 'task_reward';
