-- Migration 227 - a clean platform, keeping its configuration.
-- Cleared only if a fresh install would have the table EMPTY. If a migration
-- seeds it, it is configuration and it stays. That rule exists because
-- 20260847000000 lacked it and took fraud_checks with the test data, which
-- left the fraud layer silently dead for a month.
-- KEPT: app_config, tiers, fraud_checks, blocked_email_domains, payout_providers,
-- payout_coins, payout_coin_networks, fx_rates, game_prizes, vault_plans, communities.
-- TRUNCATE not DELETE: points_ledger is append-only with three triggers, one of
-- which refuses DELETE. Truncate does not fire row triggers, so the money guard
-- is stepped over for one statement rather than switched off and restored.
-- No CASCADE: anything outside this list pointing into it makes Postgres refuse
-- the whole statement and name the table, instead of silently clearing it.
truncate table
  public.ad_attempts, public.ad_link_clicks, public.ad_question_options,
  public.ad_question_rules, public.ad_questions, public.ad_responses,
  public.ad_tiers, public.ads, public.advertiser_payments, public.advertisers, public.admin_audit_log,
  public.admin_view_sessions, public.announcements, public.auth_signals,
  public.blocked_identities, public.coupon_redemptions, public.coupons,
  public.daily_earning_counters, public.daily_issuance, public.entitlements,
  public.game_plays, public.gift_code_attempts, public.gift_code_redemptions,
  public.gift_codes, public.hub_inbound_events, public.notifications,
  public.payout_detail_changes, public.points_ledger, public.redemptions,
  public.referral_commissions, public.referrals, public.subscription_payments,
  public.support_messages, public.support_threads, public.system_alerts,
  public.task_completions, public.tasks, public.user_ad_state,
  public.user_balances, public.user_devices, public.user_payout_details,
  public.user_security, public.user_session_records, public.user_subscriptions,
  public.vault_investments, public.vault_payments
  restart identity;

-- Everyone except the super admin. Who to keep is asked of is_super_admin
-- rather than pasted as an id, so it cannot remove the wrong person. With no
-- super admin it deletes nobody and raises, because an empty platform with no
-- way into it is not a state to reach by accident.
do $do$
declare v_admins int; v_users int;
begin
  select count(*) into v_admins from public.profiles p where public.is_super_admin(p.id);
  select count(*) into v_users from auth.users;

  /* No accounts at all means a database built from the migration history,
     where there is nothing to clear and nobody to lock out. Only refuse when
     there are accounts to remove and no administrator to keep. */
  if v_users = 0 then
    raise notice 'No accounts on this database, so there is nobody to clear.';
    return;
  end if;

  if v_admins = 0 then
    raise exception 'Refusing to clear accounts: no super admin found, so this would leave no way in'
      using errcode = 'check_violation';
  end if;
  delete from auth.users u
   where not exists (select 1 from public.profiles p
                      where p.id = u.id and public.is_super_admin(p.id));
end;
$do$;
