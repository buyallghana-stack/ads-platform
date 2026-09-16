-- ============================================================================
-- Migration 226 — clearing what the affiliate removal left behind
--
-- 20260865000000 removed the Phase 2 estate but not the code that read it.
-- Postgres does not resolve a name inside plpgsql until the statement runs, so
-- 87 functions survived pointing at tables that are no longer there. Each was
-- a landmine that raised only when something called it, and two sat on paths
-- somebody used every week: announcements, and creating a plan. Those were
-- repaired in 20260867000000, and the coupon four in 20260871000000.
--
-- The remaining 82 are removed rather than repaired, because there is nothing
-- left to repair them against: they read the affiliate ledger, the shop
-- catalogue, the training course and the certificates. A function that cannot
-- work is worse than a missing one, because it reads as a feature to the next
-- person studying the schema.
--
-- None is called by the application. Checked by matching every rpc('...') call
-- in src/ against this list. The one exception was `certificate_by_code`,
-- behind the public /verify/[code] page, and that page goes in the same
-- commit: it verified training certificates, and there are none.
--
-- The tables at the bottom are the other half of the leftovers. CASCADE took
-- what pointed AT the removed tables, but these pointed at nothing and so
-- survived holding orphaned rows: 50 quiz options, 17 quiz questions, 24
-- affiliate game prizes, 12 lesson progress rows. Nothing that survives
-- references any of them, checked against pg_constraint first. `bundle_items`
-- goes with them, and takes its own broken shape guard with it.
--
-- ⚠️ A migration cannot undo this. The rows are gone, and the only copy is
-- whatever backup Supabase holds for the day it ran.
-- ============================================================================

drop function if exists public.quiz_for_learner(p_quiz_id uuid);
drop function if exists public.affiliate_upline_for(p_user_id uuid);
drop function if exists public.mark_lesson_read(p_user_id uuid, p_lesson_id uuid);
drop function if exists public.admin_delete_section(p_admin_id uuid, p_section_id uuid);
drop function if exists public.admin_delete_lesson(p_admin_id uuid, p_lesson_id uuid);
drop function if exists public.admin_reorder_lessons(p_admin_id uuid, p_section_id uuid, p_lesson_ids uuid[]);
drop function if exists public.admin_reorder_sections(p_admin_id uuid, p_product_id uuid, p_section_ids uuid[]);
drop function if exists public.product_price_minor(p_product_id uuid);
/* `cascade` because a trigger on bundle_items still points at this, and the
   table itself is dropped at the bottom of this file. The trigger guarded a
   shape it can no longer check: it looked up both sides in public.products. */
drop function if exists public.bundle_items_shape_guard() cascade;
drop function if exists public.grant_order_entitlements(p_order_id uuid);
drop function if exists public.training_programs_product_guard();
drop function if exists public.affiliate_parent_guard();
drop function if exists public.affiliate_depth_now(p_affiliate_id uuid);
drop function if exists public.evaluate_affiliate_activation(p_user_id uuid, p_product_id uuid);
drop function if exists public.training_completion_percent(p_user_id uuid, p_product_id uuid);
drop function if exists public.generate_affiliate_code();
drop function if exists public.record_lesson_progress(p_user_id uuid, p_lesson_id uuid, p_seconds integer, p_percent integer, p_quiz_passed boolean);
drop function if exists public.record_affiliate_click(p_affiliate_code text, p_product_id uuid, p_subid text, p_visitor_token text, p_user_id uuid, p_ip inet, p_user_agent text, p_fingerprint text, p_referrer text, p_landing_url text);
drop function if exists public.affiliate_balance_minor(p_affiliate_id uuid);
drop function if exists public.affiliate_pending_minor(p_affiliate_id uuid);
drop function if exists public.clear_due_commissions();
drop function if exists public.pay_conversion_commissions(p_conversion_id uuid);
drop function if exists public.reverse_conversion_commissions(p_conversion_id uuid, p_reason text);
drop function if exists public.affiliate_recruitment_share(p_from timestamp with time zone, p_to timestamp with time zone);
drop function if exists public.reconcile_commission_ledger();
drop function if exists public.admin_affiliate_promotion_report(p_from timestamp with time zone, p_to timestamp with time zone);
drop function if exists public.affiliate_earnings_by_year(p_year integer);
drop function if exists public.lesson_is_ready(p_lesson_id uuid);
drop function if exists public.attribute_order(p_order_id uuid, p_visitor_token text);
drop function if exists public.admin_list_vendors();
drop function if exists public.admin_course_curriculum(p_product_id uuid);
drop function if exists public.admin_list_affiliates(p_scope text);
drop function if exists public.admin_list_conversions(p_from timestamp with time zone, p_to timestamp with time zone, p_affiliate_id uuid);
drop function if exists public.admin_list_commissions(p_status text, p_affiliate_id uuid, p_from timestamp with time zone);
drop function if exists public.admin_commission_totals(p_from timestamp with time zone, p_to timestamp with time zone);
drop function if exists public.affiliate_promote_info(p_user_id uuid, p_product_id uuid);
drop function if exists public.settle_lesson_completion(p_user_id uuid, p_lesson_id uuid);
drop function if exists public.warn_expiring_entitlements();
drop function if exists public.admin_list_commission_payouts(p_status text);
drop function if exists public.admin_delete_quiz(p_admin_id uuid, p_quiz_id uuid);
drop function if exists public.affiliate_dashboard_core(p_user_id uuid);
drop function if exists public.lesson_for_learner(p_user_id uuid, p_lesson_id uuid);
drop function if exists public.product_publish_blockers(p_product_id uuid);
drop function if exists public.admin_lesson_detail(p_admin_id uuid, p_lesson_id uuid);
drop function if exists public.course_outline(p_product_id uuid);
drop function if exists public.training_offers_json();
drop function if exists public.certificate_grade_for(p_user_id uuid, p_product_id uuid);
drop function if exists public.my_learning(p_user_id uuid);
drop function if exists public.affiliate_performance(p_user_id uuid, p_days integer);
drop function if exists public.course_resources(p_product_id uuid, p_user_id uuid);
drop function if exists public.shop_products(p_user_id uuid);
drop function if exists public.admin_vendor_sales_report(p_from timestamp with time zone, p_to timestamp with time zone);
drop function if exists public.affiliate_weekly_play_allowance(p_user_id uuid);
drop function if exists public.affiliate_leaderboard(p_period text, p_limit integer);
drop function if exists public.affiliate_task_progress(p_user_id uuid, p_metric affiliate_task_metric);
drop function if exists public.get_affiliate_tasks(p_user_id uuid);
drop function if exists public.admin_delete_affiliate_task(p_admin_id uuid, p_task_id uuid);
drop function if exists public.lesson_checkpoints_passed(p_user_id uuid, p_lesson_id uuid);
drop function if exists public.admin_list_affiliate_tasks(p_admin_id uuid);
drop function if exists public.admin_affiliate_task_exposure(p_admin_id uuid, p_metric affiliate_task_metric, p_target integer, p_task_id uuid);
drop function if exists public.admin_save_affiliate_task(p_admin_id uuid, p_task jsonb);
drop function if exists public.play_affiliate_game(p_user_id uuid, p_game affiliate_game_kind);
drop function if exists public.admin_affiliate_terms_status(p_admin_id uuid);
drop function if exists public.affiliate_dashboard(p_user_id uuid);
drop function if exists public.my_certificate(p_user_id uuid, p_product_id uuid);
drop function if exists public.generate_commission_gift_code();
drop function if exists public.admin_create_commission_gift_code(p_admin_id uuid, p_code text, p_amount_minor bigint, p_note text, p_expires_at timestamp with time zone);
drop function if exists public.admin_revoke_commission_gift_code(p_admin_id uuid, p_code_id uuid);
drop function if exists public.admin_list_commission_gift_codes(p_admin_id uuid, p_status gift_code_status);
drop function if exists public.admin_list_products(p_purpose text);
drop function if exists public.admin_save_affiliate_program(p_admin_id uuid, p_product_id uuid, p_l1 numeric, p_l2 numeric, p_window_hours integer, p_hold_days integer, p_active boolean);
drop function if exists public.admin_remove_affiliate_program(p_admin_id uuid, p_product_id uuid);
drop function if exists public.set_certificate_name(p_user_id uuid, p_product_id uuid, p_legal_name text);
drop function if exists public.issue_certificate_if_earned(p_user_id uuid, p_product_id uuid);
drop function if exists public.quiz_is_passed(p_user_id uuid, p_quiz_id uuid);
drop function if exists public.course_curriculum(p_product_id uuid, p_user_id uuid);
drop function if exists public.lesson_quiz_states(p_user_id uuid, p_lesson_id uuid);
drop function if exists public.affiliate_statement(p_user_id uuid, p_limit integer);
drop function if exists public.certificate_by_code(p_code text);
drop function if exists public.shop_product(p_slug text, p_user_id uuid);
drop function if exists public.owned_training_rank(p_user_id uuid);
drop function if exists public.training_upgrade_offer(p_user_id uuid);

drop table if exists public.affiliate_entitlements cascade;
drop table if exists public.affiliate_game_plays cascade;
drop table if exists public.affiliate_game_prizes cascade;
drop table if exists public.affiliate_task_completions cascade;
drop table if exists public.conversions cascade;
drop table if exists public.lesson_progress cascade;
drop table if exists public.lesson_resources cascade;
drop table if exists public.quiz_options cascade;
drop table if exists public.quiz_questions cascade;
drop table if exists public.saved_products cascade;
drop table if exists public.vendors cascade;
drop table if exists public.bundle_items cascade;
