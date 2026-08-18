-- ============================================================================
-- Migration 215 — Vault task metric function update & Milestone seed tasks
--
-- 1. Updates public.user_task_metric to support 'vault_deposits_made'
-- 2. Seeds initial Vault deposit milestones
-- 3. Seeds the full Referral milestone ladder (activated & purchased referrals)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The metric function, updated with vault_deposits_made
-- ---------------------------------------------------------------------------

create or replace function public.user_task_metric(
  p_user_id uuid,
  p_metric  public.task_metric
)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v bigint;
begin
  case p_metric

    when 'account_created' then
      select count(*) into v from public.profiles p where p.id = p_user_id;

    when 'plans_purchased' then
      select count(*) into v from public.subscription_payments s
       where s.user_id = p_user_id and s.status = 'confirmed';

    when 'ads_watched' then
      select count(*) into v from public.points_ledger l
       where l.user_id = p_user_id and l.entry_type = 'ad_view';

    when 'surveys_completed' then
      select count(*) into v from public.points_ledger l
       where l.user_id = p_user_id and l.entry_type = 'survey';

    when 'points_earned' then
      select coalesce(b.lifetime_earned, 0) into v
        from public.user_balances b where b.user_id = p_user_id;

    when 'referrals_activated' then
      /* Invitees who have EARNED something — a survey counts as much as a
         video, and is more work. Still measures what the invitee did, never
         how many accounts exist. */
      select count(*) into v
        from public.profiles r
       where r.referred_by = p_user_id
         and r.deleted_at is null
         and exists (
           select 1 from public.points_ledger l
            where l.user_id = r.id
              and l.entry_type in ('ad_view', 'survey')
         );

    when 'referrals_purchased' then
      /* Invitees who bought a plan, counted ONCE EACH. Twenty purchased
         plans means twenty referred people — somebody stacking four plans is
         still one referral, which is why this counts profiles and not
         payments. */
      select count(*) into v
        from public.profiles r
       where r.referred_by = p_user_id
         and r.deleted_at is null
         and exists (
           select 1 from public.subscription_payments s
            where s.user_id = r.id and s.status = 'confirmed'
         );

    when 'vault_deposits_made' then
      /* Count of vault investments funded by the user */
      select count(*) into v
        from public.vault_investments vi
       where vi.user_id = p_user_id;

    when 'games_played' then
      select count(*) into v from public.game_plays g where g.user_id = p_user_id;

    when 'gift_codes_redeemed' then
      select count(*) into v from public.gift_code_redemptions r where r.user_id = p_user_id;

    when 'withdrawals_made' then
      select count(*) into v from public.redemptions d
       where d.user_id = p_user_id and d.status = 'paid';

    when 'has_2fa' then
      select count(*) into v from public.user_security s
       where s.user_id = p_user_id and s.totp_confirmed_at is not null;

    when 'has_avatar' then
      select count(*) into v from public.profiles p
       where p.id = p_user_id and p.avatar_path is not null;

    when 'has_withdrawal_pin' then
      select count(*) into v from public.user_security s
       where s.user_id = p_user_id and s.pin_hash is not null;

    else
      v := 0;
  end case;

  return coalesce(v, 0);
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Seed Vault Milestones
-- ---------------------------------------------------------------------------

insert into public.tasks
  (code, name, description, metric, target, reward_points, icon, sort_order)
values
  (
    'first_vault_deposit',
    'Vault Starter',
    'Lock your first deposit into a SidePerks Vault plan and start earning daily returns.',
    'vault_deposits_made',
    1,
    500,
    '🏦',
    85
  ),
  (
    'five_vault_deposits',
    'Vault Builder',
    'Lock 5 deposits into SidePerks Vault plans to build steady daily returns.',
    'vault_deposits_made',
    5,
    2500,
    '💰',
    86
  )
on conflict (code) do nothing;


-- ---------------------------------------------------------------------------
-- 3. Seed Referral Milestones Ladder
-- ---------------------------------------------------------------------------

insert into public.tasks
  (code, name, description, metric, target, reward_points, icon, sort_order)
values
  -- Activated referrals (invited friend watched an ad or took a survey)
  (
    'first_referral',
    'First Friend',
    'Invite your first active friend who watches an ad or takes a survey.',
    'referrals_activated',
    1,
    500,
    '👋',
    98
  ),
  (
    'ten_referrals',
    'Community Builder',
    'Invite 10 active friends who watch an ad or take a survey.',
    'referrals_activated',
    10,
    5000,
    '👥',
    101
  ),
  (
    'twenty_five_referrals',
    'Influencer',
    'Invite 25 active friends who watch an ad or take a survey.',
    'referrals_activated',
    25,
    15000,
    '🌟',
    102
  ),
  (
    'fifty_referrals',
    'Ambassador',
    'Invite 50 active friends who watch an ad or take a survey.',
    'referrals_activated',
    50,
    35000,
    '👑',
    103
  ),

  -- Purchased referrals (invited friend bought a subscription plan)
  (
    'first_referral_paid',
    'First Paid Referral',
    'Invite your first friend who upgrades to any paid plan.',
    'referrals_purchased',
    1,
    1000,
    '🚀',
    104
  ),
  (
    'ten_referrals_paid',
    'Master Recruiter',
    'Invite 10 distinct friends who upgrade to any paid plan.',
    'referrals_purchased',
    10,
    12000,
    '💎',
    106
  ),
  (
    'twenty_five_referrals_paid',
    'Network Pioneer',
    'Invite 25 distinct friends who upgrade to any paid plan.',
    'referrals_purchased',
    25,
    35000,
    '🏆',
    107
  )
on conflict (code) do nothing;
