-- ============================================================================
-- Migration 248 - the `team_members` task metric (enum value only)
--
-- On its own because a new enum value cannot be used in the transaction that
-- adds it. 20260897000000 is where it is measured and where the milestone
-- ladder is built on it.
-- ============================================================================

alter type public.task_metric add value if not exists 'team_members';
