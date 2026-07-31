-- ============================================================================
-- Migration 089 — a third ad format: `link`
--
-- Operator, 2026-07-31: an ad that is an article the user reads, ending in a
-- link out to the advertiser's site or app. "What matters to me is that was
-- the link clicked — if yes the system will automatically award them."
--
-- VALUE ONLY, USED BY NOTHING. Postgres will not let an enum value be used in
-- the transaction that adds it, which is why 039 and 085 were split the same
-- way. Everything that reads or writes this lives in 090.
-- ============================================================================

alter type public.ad_format add value if not exists 'link';
