-- ============================================================================
-- Migration 085 — the three staff roles, as enum values ONLY
--
-- Operator, 2026-07-31: admins should be addable by email, with three roles —
-- super admin (what they hold today), support (messages), and ads manager
-- (adding ads).
--
-- THIS MIGRATION ADDS THE VALUES AND USES NONE OF THEM, and it has to be its
-- own file for that reason: Postgres will not let a value added to an enum be
-- USED in the same transaction that added it. Migration 039 was split for
-- exactly this and the note there is worth repeating here rather than
-- rediscovering. Everything that reads or writes these roles is in 086.
-- ============================================================================

alter type public.app_role add value if not exists 'super_admin';
alter type public.app_role add value if not exists 'support';
alter type public.app_role add value if not exists 'ads_manager';
