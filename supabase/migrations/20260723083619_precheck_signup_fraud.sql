-- ============================================================================
-- Migration 023 — Pre-signup fraud check
--
-- evaluate_signup_fraud() records signals against a user, so it can only run
-- once an account exists. But the two checks that BLOCK — disposable email and
-- known VPN ranges — should refuse before anything is created. Otherwise every
-- blocked attempt leaves an orphaned auth user and profile behind, and the
-- person sees "account created" followed by "you are blocked".
--
-- This runs the blocking checks alone and returns a decision. Nothing is
-- recorded, because there is no user to record it against; the full evaluation
-- still runs immediately after creation and captures every signal including
-- these.
--
-- Whether each check blocks or merely flags is read from fraud_checks, so
-- switching disposable_email to flag-only in the dashboard changes this too —
-- there is no second copy of that policy (§7).
-- ============================================================================

create or replace function public.precheck_signup_fraud(
  p_email text,
  p_ip    inet default null
)
returns public.fraud_decision
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.fraud_checks;
  v_fired text[] := array[]::text[];
begin
  -- Disposable email
  if public.fraud_is_email_domain_blocked(p_email) then
    select * into v_check from public.fraud_checks where code = 'disposable_email';
    if found and v_check.is_enabled then
      v_fired := v_fired || 'disposable_email'::text;
      if v_check.action = 'block' then
        return row(
          false,
          'This email provider is not accepted. Please use a permanent address.',
          0, 'high'::public.risk_level, v_fired
        )::public.fraud_decision;
      end if;
    end if;
  end if;

  -- VPN / proxy / datacenter
  if public.fraud_is_ip_blocked(p_ip) then
    select * into v_check from public.fraud_checks where code = 'vpn_or_proxy';
    if found and v_check.is_enabled then
      v_fired := v_fired || 'vpn_or_proxy'::text;
      if v_check.action = 'block' then
        return row(
          false,
          'Please disable your VPN or proxy and try again.',
          0, 'high'::public.risk_level, v_fired
        )::public.fraud_decision;
      end if;
    end if;
  end if;

  return row(true, null, 0, 'low'::public.risk_level, v_fired)::public.fraud_decision;
end;
$$;

comment on function public.precheck_signup_fraud(text, inet) is
  'Runs only the blocking fraud checks, before an account exists. Records nothing — evaluate_signup_fraud does that once there is a user to attribute signals to.';

revoke execute on function public.precheck_signup_fraud(text, inet)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Email uniqueness, checked politely
-- ---------------------------------------------------------------------------
--
-- Supabase returns a deliberately vague error when an email is already
-- registered, to avoid confirming account existence. That is right for a
-- public API and wrong for our own signup form, where the honest message is
-- "you already have an account, log in".
--
-- The trade-off is real: this makes signup an existence oracle. It is
-- acceptable here and not on password reset, because someone can already
-- discover the same fact by attempting to sign up — whereas reset would leak
-- it without any action from them. Reset stays deliberately vague.

create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke execute on function public.email_is_registered(text) from public, anon, authenticated;
