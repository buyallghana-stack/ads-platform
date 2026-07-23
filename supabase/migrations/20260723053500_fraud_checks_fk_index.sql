-- ============================================================================
-- Migration 016 — Covering index for fraud_checks.updated_by
--
-- Raised by the performance advisor after 014. Low traffic, but the column
-- references auth.users, and without a covering index every user deletion
-- sequentially scans fraud_checks to enforce the constraint. Same reasoning as
-- the FK indexes added in migration 005.
-- ============================================================================

create index fraud_checks_updated_by_idx on public.fraud_checks (updated_by)
  where updated_by is not null;
