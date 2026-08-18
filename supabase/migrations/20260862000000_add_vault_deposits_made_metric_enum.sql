-- ============================================================================
-- Migration 214 — the `vault_deposits_made` task metric enum
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction block that
-- adds it when used by functions/DDL. Migration 215 uses it.
-- ============================================================================

alter type public.task_metric add value if not exists 'vault_deposits_made';
