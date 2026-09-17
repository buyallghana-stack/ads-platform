-- ============================================================================
-- Migration 231 — test money does not buy a plan
--
-- The Tech Store wrote on 17 September 2026 to say their Paystack account has
-- been in TEST mode in production since the beginning. They did not find it in
-- configuration, because a secret key cannot be read back out of a deployment.
-- They found it in their own data: Paystack stamps `domain` on every
-- transaction object it returns, they store the whole object, and every row in
-- their database says `test`.
--
-- Six SidePerks payments were reported successful on that account. Each one
-- arrived here over a correctly signed request, each one was a genuine
-- `payment.success`, and each one granted a plan. No money moved for any of
-- them.
--
-- NOTHING MALFUNCTIONED, which is the uncomfortable part. The hub reported
-- what Paystack told it. This app believed the hub. Both were right to. What
-- was missing was anyone asking WHICH Paystack, and neither app could see the
-- answer because neither app was looking at the one field that carries it.
--
-- So this app looks now, in `src/lib/payments/hub/decide.ts`, and this is the
-- switch that says what to do about it. Off means a payment the hub reports
-- from a test-mode account is recorded, flagged on the admin payments screen,
-- and granted nothing. The hub is still answered 2xx: it told the truth, and
-- retrying the truth for 24 hours does not change it.
--
-- ⚠️ THE CHECK IS NOT ARMED YET, and this migration is still worth applying.
-- `domain` is not in the hub contract and the hub does not forward it, so
-- today every event reads as `unknown` and passes. The switch and the reading
-- ship together so that the day the Tech Store adds the field, the guard is
-- already live rather than being written under time pressure with real money
-- moving. Absence stays permissive on purpose: refusing everything we cannot
-- classify would refuse every real payment to catch a case we cannot yet see.
-- ============================================================================

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('hub_accept_test_payments', 'false', 'bool', null, null, false,
   'Whether a payment the hub reports from a Paystack account in TEST mode may grant a plan. OFF, and it should stay off outside a rehearsal: test money is not money, and a plan granted against it is a free plan with a customer attached. Turn it on only to walk an end to end rehearsal against test keys, and turn it off again afterwards. Has no effect while the hub omits the `domain` field, because a payment that cannot be classified is not refused.')
on conflict (key) do nothing;
