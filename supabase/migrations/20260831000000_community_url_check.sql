-- ============================================================================
-- Migration 183 — the community url check could never pass
--
-- `check (url ~* '^https://[^\s]{3,500}$')` looks reasonable and is not: a
-- POSIX bounded repetition may not exceed 255, so Postgres rejects the pattern
-- itself at match time with "invalid regular expression: invalid repetition
-- count(s)". Every insert failed, including from the admin screen, and the
-- operator would have read that sentence as the reason their link was refused.
--
-- Caught by driving the real screen; nothing in SQL or TypeScript could see
-- it, because the pattern is only compiled when a row is actually checked.
--
-- The rule is unchanged: https, and a length a link plausibly has. It is just
-- expressed as an unbounded repetition plus a separate length test.
-- ============================================================================

alter table public.communities drop constraint if exists communities_url_https;

alter table public.communities
  add constraint communities_url_https
  check (url ~* '^https://\S{3,}$' and length(url) <= 500);
