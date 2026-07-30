-- ============================================================================
-- Migration 079 — the `referrals_purchased` task metric
--
-- Alone, for the sixth time: `ALTER TYPE ... ADD VALUE` cannot be used in the
-- transaction that adds it. Migration 080 uses it.
--
-- Operator, 2026-07-30: reward inviting people who go on to BUY a plan, and
-- count each invitee once however many plans they buy — "a total of 20
-- purchased plans means 20 referred users". So it is a count of DISTINCT
-- referees with at least one confirmed payment, not a count of payments.
-- ============================================================================

alter type public.task_metric add value if not exists 'referrals_purchased';
