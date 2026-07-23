-- ============================================================================
-- Migration 015 — Cast array appends in evaluate_signup_fraud
--
--   v_fired := v_fired || 'device_multi_account';
--
-- fails with: malformed array literal: "device_multi_account".
--
-- `||` is overloaded for array||array and array||element. An unadorned string
-- literal has type `unknown`, so Postgres cannot tell which it is, resolves to
-- array||array, and then tries to parse the string as an array literal.
--
-- Every append in the function had this. It only surfaced when a check
-- actually fired — the earlier tests exercised paths where none did, so the
-- function appeared to work while being broken on every route that mattered.
-- Casting each literal to ::text picks the array||element overload.
-- ============================================================================

create or replace function public.evaluate_signup_fraud(
  p_user_id uuid, p_email text, p_phone text, p_ip inet, p_fingerprint text
)
returns public.fraud_decision
language plpgsql security definer set search_path = '' as $$
declare
  v_fired   text[] := array[]::text[];
  v_blocked text := null;
  v_count   int;
  v_action  public.fraud_action;
  v_risk    public.user_risk_scores;
begin
  if public.fraud_is_email_domain_blocked(p_email) then
    if public.record_fraud_signal(p_user_id, 'disposable_email',
         jsonb_build_object('domain', lower(split_part(p_email, '@', 2)))) then
      v_fired := v_fired || 'disposable_email'::text;
      select action into v_action from public.fraud_checks where code = 'disposable_email';
      if v_action = 'block' then
        v_blocked := 'This email provider is not accepted. Please use a permanent address.';
      end if;
    end if;
  end if;

  if v_blocked is null and public.fraud_is_ip_blocked(p_ip) then
    if public.record_fraud_signal(p_user_id, 'vpn_or_proxy',
         jsonb_build_object('ip', host(p_ip))) then
      v_fired := v_fired || 'vpn_or_proxy'::text;
      select action into v_action from public.fraud_checks where code = 'vpn_or_proxy';
      if v_action = 'block' then
        v_blocked := 'Please disable your VPN or proxy and try again.';
      end if;
    end if;
  end if;

  v_count := public.fraud_phone_duplicate_count(p_phone, p_user_id);
  if v_count > 0 then
    if public.record_fraud_signal(p_user_id, 'duplicate_phone',
         jsonb_build_object('other_accounts', v_count)) then
      v_fired := v_fired || 'duplicate_phone'::text;
      select action into v_action from public.fraud_checks where code = 'duplicate_phone';
      if v_action = 'block' and v_blocked is null then
        v_blocked := 'This phone number is already registered.';
      end if;
    end if;
  end if;

  v_count := public.fraud_ip_signup_velocity(p_ip, public.config_int('fraud_ip_velocity_window_hours')::int);
  if v_count > public.config_int('fraud_ip_velocity_max_signups')::int then
    if public.record_fraud_signal(p_user_id, 'ip_signup_velocity',
         jsonb_build_object('ip', host(p_ip), 'signups_in_window', v_count)) then
      v_fired := v_fired || 'ip_signup_velocity'::text;
    end if;
  end if;

  if p_fingerprint is not null then
    v_count := public.fraud_fingerprint_account_count(p_fingerprint, p_user_id);
    if v_count >= public.config_int('fraud_fingerprint_max_accounts')::int then
      if public.record_fraud_signal(p_user_id, 'device_multi_account',
           jsonb_build_object('other_accounts', v_count)) then
        v_fired := v_fired || 'device_multi_account'::text;
      end if;
    end if;
  end if;

  select * into v_risk from public.user_risk_scores where user_id = p_user_id;

  return row(
    v_blocked is null, v_blocked,
    coalesce(v_risk.score, 0),
    coalesce(v_risk.level, 'low'::public.risk_level),
    v_fired
  )::public.fraud_decision;
end;
$$;

revoke execute on function public.evaluate_signup_fraud(uuid, text, text, inet, text)
  from public, anon, authenticated;
