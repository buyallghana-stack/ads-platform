-- ============================================================================
-- Migration 128 — a config description that has been lying since July
--
-- `referral_purchase_commission_percent` tells the operator, on the settings
-- screen where they set it:
--
--   "The referrer's own tier multiplier is applied on top, so the effective
--    share of a sale is this percentage times that multiplier."
--
-- That stopped being true on 2026-07-30, when migration 081 made every
-- referral payment FLAT — `tiers.referral_bonus_multiplier` is consulted by no
-- money path and new commission rows record 1.000. It was noticed while
-- writing the configuration summary and had been flagged once before without
-- being fixed.
--
-- This matters more than a typo because of WHERE it is read. Somebody choosing
-- a percentage under the impression it will be multiplied by a Platinum
-- holder's ×4 will pick a quarter of the number they actually want. A wrong
-- number on a money setting, printed next to the box you type the number into.
--
-- The same sentence is corrected on the second-level key, which describes the
-- remainder rule correctly and is left otherwise alone.
-- ============================================================================

update public.app_config
   set description =
     'Stage-three referral commission: the percentage of what a referee pays '
     'for a plan that is credited to their referrer, as points at the pegged '
     'rate. Zero switches the stage off entirely — no ledger entry and no '
     'commission record. PAID FLAT: the referrer''s plan does not multiply it '
     '(migration 081, 2026-07-30).'
 where key = 'referral_purchase_commission_percent';
