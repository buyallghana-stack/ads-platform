-- ============================================================================
-- Migration 216 — Remove unpaid (ad-watch / signup) referral tasks & metric
--
-- Referral rewards on SidePerks require an invitee to BUY a paid subscription
-- plan. Signing up or watching free ads without a paid plan no longer qualifies
-- for task rewards.
-- ============================================================================

-- 1. Remove completions for unpaid referral tasks
delete from public.task_completions
 where task_id in (
   select id from public.tasks
    where code in ('first_referral', 'three_referrals', 'ten_referrals', 'twenty_five_referrals', 'fifty_referrals')
       or metric = 'referrals_activated'
 );

-- 2. Delete unpaid referral tasks
delete from public.tasks
 where code in ('first_referral', 'three_referrals', 'ten_referrals', 'twenty_five_referrals', 'fifty_referrals')
    or metric = 'referrals_activated';

-- 3. Update public.user_task_metric to remove referrals_activated
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
