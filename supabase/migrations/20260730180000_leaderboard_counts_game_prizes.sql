-- ============================================================================
-- Migration 073 — game winnings count on the leaderboard
--
-- The operator's leaderboard answer was "every credit, including gift codes".
-- `game_prize` did not exist when `leaderboard_counted_types` was written, so
-- it was silently absent — a user could win 5,000 points on the wheel and see
-- their standing not move, which is the kind of quiet inconsistency nobody
-- reports as a bug and everybody notices.
--
-- It joins the GRANTED group, next to gift codes and admin adjustments, not
-- the earned group. A game win is not work: it is luck, from an allowance the
-- platform hands out. So it counts while `leaderboard_counts_granted_points`
-- is on — which is the operator's chosen default — and drops out with the
-- others if that is ever turned off, rather than being a third category with
-- its own rule to remember.
--
-- Refunds remain excluded. Nothing about games changes that.
-- ============================================================================

create or replace function public.leaderboard_counted_types()
returns public.ledger_entry_type[]
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(public.config_bool('leaderboard_counts_granted_points'), true)
      then array[
        'ad_view', 'survey',
        'referral_signup', 'referral_activation', 'referral_purchase',
        'gift_code', 'admin_adjustment', 'game_prize'
      ]::public.ledger_entry_type[]
    else array[
        'ad_view', 'survey',
        'referral_signup', 'referral_activation', 'referral_purchase'
      ]::public.ledger_entry_type[]
  end;
$$;

comment on function public.leaderboard_counted_types() is
  'Ledger entry types that build a leaderboard standing. redemption_request and redemption_refund are absent by design — counting the refund would let a user farm the board by requesting withdrawals and having them declined. Granted credits (gift codes, admin adjustments, game prizes) are included per leaderboard_counts_granted_points.';
