-- ============================================================================
-- Migration 224 — the fraud layer gets its rules back
--
-- ⚠️ THE ENTIRE FRAUD LAYER HAS BEEN INERT. `public.fraud_checks` was empty,
-- and `record_fraud_signal` reads it first:
--
--     select * into v_check from public.fraud_checks where code = p_check_code;
--     if not found or not v_check.is_enabled then return false; end if;
--
-- Not found means return false. So every check in `evaluate_signup_fraud`
-- ran, found what it was looking for, called `record_fraud_signal`, and was
-- told no. No signal was written, no risk score was recomputed, and nothing
-- ever reached the review queue. A disposable email, one device carrying a
-- dozen accounts, a payout destination changed minutes before a withdrawal:
-- all of it evaluated, none of it recorded.
--
-- HOW IT HAPPENED. 20260847000000 cleared test users and their activity before
-- launch, and its delete list included `fraud_checks` between `fraud_signals`
-- and `conversions`. The signals are activity and belonged there. The CHECKS
-- are configuration: eight rules seeded by the fraud layer migration and one
-- more by the referrals migration, each with the weight that makes a score
-- mean something. Deleting them read as tidying up and was a switch off.
--
-- Nothing detected this because the failure is silent by design: a missing
-- rule returns false rather than raising, which is right for one rule that has
-- been turned off deliberately and catastrophic for all of them at once. The
-- fraud tests caught it only now, having been red since for another reason.
--
-- The rows below are the original seeds, verbatim from
-- 20260723052200_fraud_layer.sql and 20260723060500_referrals.sql. `on
-- conflict do nothing` so this is safe to run anywhere, including an
-- environment that still has them.
-- ============================================================================

insert into public.fraud_checks (code, name, description, weight, severity, action) values
  ('disposable_email', 'Disposable email domain',
   'Signup used a throwaway email provider. Blocks by default: there is no legitimate reason to use one on a platform that pays out money.',
   40, 'high', 'block'),

  ('vpn_or_proxy', 'VPN, proxy or datacenter IP',
   'Connection came from a known VPN, proxy or hosting range. Blocks by default, and reinforces the Ghana-only geo restriction (§6.9), which a VPN would otherwise defeat.',
   35, 'high', 'block'),

  ('duplicate_phone', 'Phone number already registered',
   'Another account uses this number. Flags rather than blocks: shared handsets and family numbers are common.',
   30, 'medium', 'flag'),

  ('ip_signup_velocity', 'Signup burst from one IP',
   'Several new accounts from one address in a short window. Never blocks, because a hall of residence or an internet cafe shares one address.',
   25, 'medium', 'flag'),

  ('device_multi_account', 'One device, several accounts',
   'This device fingerprint appears on multiple accounts. Fingerprinting is about 80 per cent accurate, which is enough to correlate and not enough to accuse.',
   30, 'medium', 'flag'),

  ('repeated_ad_failures', 'Repeated failed attention questions',
   'Many wrong answers in 24 hours. Consistent with automation guessing, or with a user who cannot read the questions, hence flag rather than block.',
   20, 'medium', 'flag'),

  ('payout_details_changed_recently', 'Payout details changed just before redemption',
   'Classic account takeover and farming pattern (§6.4.1): change where the money goes, then immediately cash out.',
   45, 'high', 'flag'),

  ('rapid_redemption_after_signup', 'Redeemed very soon after signing up',
   'A brand new account reaching the redemption minimum unusually fast suggests farming rather than genuine use.',
   25, 'medium', 'flag'),

  ('self_referral_suspected', 'Referrer and referee share a device or address',
   'The referred account signed up from the same device fingerprint or IP as its referrer. Flags rather than blocks: a household sharing a phone is a legitimate referral, and §6.8 relies on the two-stage activation gate as the real defence.',
   35, 'medium', 'flag')
on conflict (code) do nothing;
