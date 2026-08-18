-- =============================================================================
-- Migration: 20260861000000_drop_weekly_bonus
-- Description: Drop weekly bonus tables, functions and triggers.
--              Referral milestones are one-time rewards handled under Tasks.
-- =============================================================================

-- 1. Drop Functions
DROP FUNCTION IF EXISTS public.claim_weekly_bonus(uuid);
DROP FUNCTION IF EXISTS public.enroll_weekly_bonus();
DROP FUNCTION IF EXISTS public.unenroll_weekly_bonus();
DROP FUNCTION IF EXISTS public.get_weekly_bonus_status();
DROP FUNCTION IF EXISTS public.admin_list_weekly_bonus_campaigns(uuid);
DROP FUNCTION IF EXISTS public.admin_save_weekly_bonus_campaign(uuid, uuid, text, text, int, int, bigint, boolean, int);
DROP FUNCTION IF EXISTS public.admin_delete_weekly_bonus_campaign(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_active_referrals_count(uuid);

-- 2. Drop Tables (in dependency order)
DROP TABLE IF EXISTS public.weekly_bonus_claims CASCADE;
DROP TABLE IF EXISTS public.weekly_bonus_enrollments CASCADE;
DROP TABLE IF EXISTS public.weekly_bonus_campaigns CASCADE;
