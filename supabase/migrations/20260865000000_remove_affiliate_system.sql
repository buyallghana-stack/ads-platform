-- =============================================================================
-- Migration: Remove Affiliate System
-- Description: Completely drops all affiliate-specific tables, functions,
--              views, types, and configuration keys across the database.
-- =============================================================================

-- 1. Drop Affiliate & Training Tables (in reverse dependency order)
DROP TABLE IF EXISTS public.affiliate_terms_acceptances CASCADE;
DROP TABLE IF EXISTS public.commission_gift_code_redemptions CASCADE;
DROP TABLE IF EXISTS public.commission_gift_codes CASCADE;
DROP TABLE IF EXISTS public.affiliate_task_claims CASCADE;
DROP TABLE IF EXISTS public.affiliate_tasks CASCADE;
DROP TABLE IF EXISTS public.affiliate_game_rolls CASCADE;
DROP TABLE IF EXISTS public.affiliate_prizes CASCADE;
DROP TABLE IF EXISTS public.affiliate_settlement_entries CASCADE;
DROP TABLE IF EXISTS public.affiliate_settlements CASCADE;
DROP TABLE IF EXISTS public.commission_payouts CASCADE;
DROP TABLE IF EXISTS public.commission_ledger CASCADE;
DROP TABLE IF EXISTS public.affiliate_attributions CASCADE;
DROP TABLE IF EXISTS public.affiliate_clicks CASCADE;
DROP TABLE IF EXISTS public.affiliate_programs CASCADE;
DROP TABLE IF EXISTS public.quiz_attempts CASCADE;
DROP TABLE IF EXISTS public.quizzes CASCADE;
DROP TABLE IF EXISTS public.course_progress CASCADE;
DROP TABLE IF EXISTS public.lessons CASCADE;
DROP TABLE IF EXISTS public.course_sections CASCADE;
DROP TABLE IF EXISTS public.courses CASCADE;
DROP TABLE IF EXISTS public.certificates CASCADE;
DROP TABLE IF EXISTS public.training_programs CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.vendor_payout_details CASCADE;
DROP TABLE IF EXISTS public.affiliate_accounts CASCADE;

-- 2. Drop Affiliate Functions & RPCs
DROP FUNCTION IF EXISTS public.get_commission_breakdown(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_affiliate_dashboard(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_affiliate_statement(uuid, integer, integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.record_affiliate_click(text, text, uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.attribute_affiliate_order(text, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.request_commission_payout(uuid, bigint, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.decide_commission_payout(uuid, uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_issue_commission_gift_code(uuid, text, bigint, integer, timestamp with time zone, timestamp with time zone, text) CASCADE;
DROP FUNCTION IF EXISTS public.redeem_commission_gift_code(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.play_affiliate_game(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.claim_affiliate_task(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.accept_affiliate_terms(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.enroll_in_course(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.complete_lesson(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.submit_quiz_attempt(uuid, uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.issue_certificate(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_vendor_sales_report(timestamp with time zone, timestamp with time zone) CASCADE;
DROP FUNCTION IF EXISTS public.count_commission_payouts_awaiting_decision() CASCADE;

-- 3. Drop Affiliate Custom Enum Types
DROP TYPE IF EXISTS public.affiliate_standing CASCADE;
DROP TYPE IF EXISTS public.commission_entry_kind CASCADE;
DROP TYPE IF EXISTS public.commission_payout_status CASCADE;
DROP TYPE IF EXISTS public.lesson_kind CASCADE;
DROP TYPE IF EXISTS public.product_purpose CASCADE;
DROP TYPE IF EXISTS public.product_status CASCADE;
DROP TYPE IF EXISTS public.training_level CASCADE;

-- 4. Delete Affiliate Settings from App Config
DELETE FROM public.app_config WHERE key LIKE 'affiliate_%';
