-- ============================================================================
-- Migration 129 — the level-two default still describes the remainder rule
--
-- `affiliate_default_l2_percent` tells the operator, on the form where they set
-- the rate a new product starts with:
--
--   "Paid out of what remains of the sale after level one, so the two together
--    can never exceed it."
--
-- Migration 122 reversed that earlier the same day: both levels are now a
-- percentage of the TOTAL. The sentence is wrong in both halves — it describes
-- an arithmetic that no longer runs, and it credits the overpayment guarantee
-- to that arithmetic rather than to the constraint that actually holds it now.
--
-- This is the same fault as migration 128 and matters for the same reason: a
-- wrong description printed beside the box you type a money figure into. Here
-- it understates the payout. Somebody reading "out of what remains" picks 10%
-- believing it costs 10% of 70% — 7 pesewas in the cedi — when it costs 10.
--
-- Found while writing docs/phase2/CONFIGURATION.md, which is why that document
-- is generated from live values rather than from these descriptions.
--
-- The Phase 1 key `referral_purchase_commission_percent_l2` says the same thing
-- and is left alone: migration 122 changed `pay_conversion_commissions` only,
-- so the points referral ladder genuinely still pays level two from the
-- remainder. Two rules that read alike and are not the same.
-- ============================================================================

update public.app_config
   set description =
     'Level-two override suggested for a NEW product. A percentage of the FULL '
     'amount the buyer paid, exactly like level one (migration 122, '
     '2026-08-06) — not of what is left after it. The two rates together may '
     'not exceed 100%, which is refused when the product is saved. Every '
     'product stores its own rate; this is only the starting value the admin '
     'form offers.'
 where key = 'affiliate_default_l2_percent';
