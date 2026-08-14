-- ============================================================================
-- Migration 199 — purge test users and user activity for clean production launch
--
-- Preserves:
--   - admin@email.com (Super Admin account)
--   - All Ads, Questions, Options, Tiers, Configurations, Products, Coupons, Games
--
-- Purges:
--   - All non-admin test accounts (auth.users, profiles, user_roles)
--   - All test user activity across the app (points_ledger, balances,
--     subscriptions, payments, ad progress, redemptions, referrals, games)
-- ============================================================================

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id from auth.users where email = 'admin@email.com';

  if v_admin_id is null then
    raise exception 'Admin account admin@email.com not found!' using errcode = 'check_violation';
  end if;

  -- 1. Disable triggers on append-only / protected tables
  alter table public.points_ledger disable trigger points_ledger_no_delete;
  alter table public.points_ledger disable trigger points_ledger_no_update;
  alter table public.points_ledger disable trigger points_ledger_referral_activation;

  -- 2. Wipe user activities across the platform
  delete from public.support_messages;
  delete from public.support_threads;
  delete from public.game_plays;
  delete from public.affiliate_game_plays;
  delete from public.coupon_redemptions;
  delete from public.notifications;
  delete from public.blocked_identities;
  delete from public.redemptions;
  delete from public.orders;
  delete from public.referral_commissions;
  delete from public.referrals;
  delete from public.ad_responses;
  delete from public.ad_attempts;
  delete from public.ad_link_clicks;
  delete from public.user_ad_state;
  delete from public.user_subscriptions;
  delete from public.subscription_payments;
  delete from public.daily_earning_counters;
  delete from public.points_ledger;
  delete from public.user_balances;
  delete from public.user_devices;
  delete from public.user_security;
  delete from public.user_session_records;
  delete from public.user_payout_details;
  delete from public.user_risk_scores;
  delete from public.user_backup_codes;
  delete from public.auth_signals;
  delete from public.fraud_signals;
  delete from public.fraud_checks;
  delete from public.conversions;
  delete from public.affiliate_clicks;
  delete from public.affiliate_task_completions;
  delete from public.task_completions;
  delete from public.reading_progress;
  delete from public.lesson_progress;
  delete from public.quiz_attempts;
  delete from public.saved_products;
  delete from public.gift_code_attempts;
  delete from public.gift_code_redemptions;
  delete from public.commission_gift_code_redemptions;
  delete from public.commission_ledger;
  delete from public.commission_payouts;

  -- 3. Re-enable ledger triggers
  alter table public.points_ledger enable trigger points_ledger_no_delete;
  alter table public.points_ledger enable trigger points_ledger_no_update;
  alter table public.points_ledger enable trigger points_ledger_referral_activation;

  -- 4. Delete non-admin user roles and profiles
  delete from public.user_roles where user_id <> v_admin_id;
  delete from public.profiles where id <> v_admin_id;

  -- 5. Delete non-admin auth records
  delete from auth.identities where user_id <> v_admin_id;
  delete from auth.sessions where user_id <> v_admin_id;
  delete from auth.users where id <> v_admin_id;

  -- 6. Clean admin profile state
  update public.profiles
     set referred_by = null,
         disabled_at = null,
         flagged_at = null,
         deletion_requested_at = null,
         deletion_effective_at = null,
         deleted_at = null
   where id = v_admin_id;

  -- 7. Ensure admin user has super_admin role
  delete from public.user_roles where user_id = v_admin_id;
  insert into public.user_roles (user_id, role)
  values (v_admin_id, 'super_admin');

end $$;
