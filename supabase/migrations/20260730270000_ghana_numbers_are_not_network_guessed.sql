-- ============================================================================
-- Migration 082 — stop inferring the network from a Ghanaian number
--
-- Operator, 2026-07-30, after failing to sign up with their own real number:
-- "let the user decide their service provider, not you."
--
-- WHAT WAS WRONG. Each provider carried its own `number_pattern` and
-- `set_payout_details` matched the entered number against the SELECTED
-- provider's pattern:
--
--   MTN         ^(\+233|0)(24|54|55|59)[0-9]{7}$
--   Telecel     ^(\+233|0)(20|50)[0-9]{7}$
--   AirtelTigo  ^(\+233|0)(26|27|56|57)[0-9]{7}$
--
-- Between them those cover 24 54 55 59 20 50 26 27 56 57 and nothing else, so
-- a genuine 021, 023, 025, 028, 051, 052, 053 or 058 number was refused by
-- ALL THREE. The ranges also go stale the moment the NCA allocates a new one,
-- and they are simply wrong for a PORTED number — somebody who moved their
-- 024 to AirtelTigo could not select the network that actually holds it.
--
-- Guessing the network from a prefix is a claim the platform is in no
-- position to make. The user knows which network they are on; the payout
-- rail will reject a genuinely wrong pairing far more reliably than a regex
-- that was out of date the day it was written.
--
-- THE FIX IS DATA, NOT CODE. The per-provider pattern mechanism stays — a
-- future country will want it — but all three Ghanaian providers now carry
-- the same rule the operator specified: starts 02 or 05, ten digits.
--
--   ^(\+233|0)[25][0-9]{8}$
--
-- Local form is 0 + 2|5 + eight digits = ten characters. The +233 form is the
-- same number without its leading zero, so the digit count after the prefix
-- is identical and one pattern covers both. `set_payout_details` strips
-- spaces before matching, so a number typed "024 123 4567" still passes.
-- ============================================================================

update public.payout_providers
   set number_pattern = '^(\+233|0)[25][0-9]{8}$',
       updated_at = now()
 where country_code = 'GH'
    or code in ('MTN_MOMO', 'TELECEL', 'AIRTELTIGO');

comment on column public.payout_providers.number_pattern is
  'Shape a payout number must take for this provider. For Ghana all providers share one permissive rule (02/05, ten digits) because the NETWORK IS THE USER''S DECLARATION, not something to infer from a prefix — prefix ranges go stale and are wrong for ported numbers.';
