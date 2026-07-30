-- ============================================================================
-- Migration 075 — `game_plays_combine_mode` gets an allowed-value guard
--
-- It is the third free-text setting in the product, and the other two are
-- both listed here. `user_weekly_play_allowance` branches on exactly two
-- words: 'sum_bonus', and an else that takes the highest plan. Without this,
-- a typo saved from the settings screen ("Highest", "max") would fall through
-- to the else and silently behave as "highest" — which is the same class of
-- bug the combine-mode entry above was added to fix, where `multiply` was
-- offered by a screen and understood by nothing.
--
-- The screen's select and this array must agree; the point of putting it in
-- the database is that a save fails loudly when they do not.
-- ============================================================================

create or replace function public.config_allowed_values(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'subscription_multiplier_combine_mode'
      then array['sum_bonus', 'sum', 'product', 'highest']
    when 'referral_purchase_commission_scope'
      then array['first', 'new_plans', 'all']
    when 'game_plays_combine_mode'
      then array['highest', 'sum_bonus']
    else null
  end;
$$;
