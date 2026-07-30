-- ============================================================================
-- Migration 069 — the `game_prize` ledger entry type
--
-- Its own migration, alone, for the reason this project has hit four times
-- now: `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that
-- adds it. Migration 070 does the rest and is free to reference this label.
--
-- Points won in a game are a distinct kind of credit, not an
-- `admin_adjustment`: the transaction history has to be able to say "Mystery
-- box" rather than "Account correction", and the leaderboard's counted-types
-- list has to be able to make a deliberate decision about it.
-- ============================================================================

alter type public.ledger_entry_type add value if not exists 'game_prize';
