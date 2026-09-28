-- SMS codes: three at a go, then a lockout that grows.
--
-- Operator direction 2026-09-28: a number can be sent 3 codes; after that it
-- waits 5 minutes, and every further lockout grows exponentially in hours.
-- Decided here (the operator delegates the detail when it is configurable):
--
--   * The lock starts when the 3rd code goes out, not when a 4th is refused,
--     so "3 codes, then 5 minutes" reads the way it was said.
--   * Lockouts run 5 minutes, then 1h, 2h, 4h, 8h ... capped at 24h.
--   * A code entered correctly clears the count: the number is proved, and
--     somebody who signed up should not start a password reset half-locked.
--   * A day with no lockout forgives the history.
--
-- Replaces `otp_hourly_limit` (5 an hour), which this supersedes. Every knob is
-- in app_config. The 60-second resend cooldown is unchanged.

-- ---------------------------------------------------------------------------
-- 1. Per-number lockout state
-- ---------------------------------------------------------------------------

create table if not exists public.otp_lockouts (
  phone          text primary key,
  -- How many lockouts this number has earned; picks the next one's length.
  strikes        int  not null default 0,
  -- Codes sent after this moment count towards the next lockout.
  window_start   timestamptz not null default now(),
  locked_until   timestamptz,
  last_strike_at timestamptz
);

alter table public.otp_lockouts enable row level security;
-- No policies: nobody but the service role reads or writes it.
revoke all on public.otp_lockouts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The knobs
-- ---------------------------------------------------------------------------

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('otp_codes_before_lock', '3', 'int', 1, 10, false,
   'How many SMS codes one phone number can be sent before it is locked out for a while. Each one costs money.'),
  ('otp_first_lock_minutes', '5', 'int', 1, 60, false,
   'How long the FIRST lockout lasts, in minutes.'),
  ('otp_lock_base_hours', '1', 'int', 1, 24, false,
   'How long the SECOND lockout lasts, in hours. Every lockout after it doubles.'),
  ('otp_lock_max_hours', '24', 'int', 1, 168, false,
   'The longest a lockout can grow to, in hours.'),
  ('otp_lock_reset_hours', '24', 'int', 1, 168, false,
   'After this many hours without a lockout, a number starts again from the short first lockout.')
on conflict (key) do nothing;

delete from public.app_config where key = 'otp_hourly_limit';

-- ---------------------------------------------------------------------------
-- 3. Issuing a code
-- ---------------------------------------------------------------------------

create or replace function public.otp_issue(
  p_purpose   text,
  p_phone     text,
  p_user_id   uuid,
  p_code_hash text,
  p_ip        inet default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl        int := coalesce((select value::int from public.app_config where key = 'otp_ttl_minutes'), 10);
  v_resend     int := coalesce((select value::int from public.app_config where key = 'otp_resend_seconds'), 60);
  v_burst      int := coalesce((select value::int from public.app_config where key = 'otp_codes_before_lock'), 3);
  v_first_min  int := coalesce((select value::int from public.app_config where key = 'otp_first_lock_minutes'), 5);
  v_base_h     int := coalesce((select value::int from public.app_config where key = 'otp_lock_base_hours'), 1);
  v_max_h      int := coalesce((select value::int from public.app_config where key = 'otp_lock_max_hours'), 24);
  v_reset_h    int := coalesce((select value::int from public.app_config where key = 'otp_lock_reset_hours'), 24);
  v_lock       public.otp_lockouts;
  v_last       timestamptz;
  v_count      int;
  v_len        interval;
  v_row        public.phone_otps;
begin
  perform pg_advisory_xact_lock(hashtext('phone_otp:' || p_phone));

  select * into v_lock from public.otp_lockouts where phone = p_phone;

  -- A quiet day forgives the history.
  if v_lock.phone is not null
     and (v_lock.locked_until is null or v_lock.locked_until <= now())
     and coalesce(v_lock.last_strike_at, v_lock.window_start) < now() - make_interval(hours => v_reset_h) then
    delete from public.otp_lockouts where phone = p_phone;
    v_lock := null;
  end if;

  if v_lock.locked_until is not null and v_lock.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'retry_after', v_lock.locked_until);
  end if;

  select max(created_at) into v_last
    from public.phone_otps
   where phone = p_phone and purpose = p_purpose;

  if v_last is not null and v_last > now() - make_interval(secs => v_resend) then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retry_after', v_last + make_interval(secs => v_resend));
  end if;

  update public.phone_otps
     set consumed_at = now()
   where phone = p_phone and purpose = p_purpose and consumed_at is null;

  insert into public.phone_otps (purpose, phone, user_id, code_hash, expires_at, ip)
  values (p_purpose, p_phone, p_user_id, p_code_hash, now() + make_interval(mins => v_ttl), p_ip)
  returning * into v_row;

  -- Across every purpose: it is the number that costs money, not the flow.
  select count(*) into v_count
    from public.phone_otps
   where phone = p_phone
     and created_at > coalesce(v_lock.window_start, now() - make_interval(hours => v_reset_h));

  if v_count >= v_burst then
    v_len := case
      when coalesce(v_lock.strikes, 0) = 0 then make_interval(mins => v_first_min)
      else least(make_interval(hours => v_base_h) * power(2, v_lock.strikes - 1)::int,
                 make_interval(hours => v_max_h))
    end;
    insert into public.otp_lockouts (phone, strikes, window_start, locked_until, last_strike_at)
    values (p_phone, 1, now() + v_len, now() + v_len, now())
    on conflict (phone) do update
      set strikes        = public.otp_lockouts.strikes + 1,
          window_start   = excluded.window_start,
          locked_until   = excluded.locked_until,
          last_strike_at = excluded.last_strike_at;
  end if;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'expires_at', v_row.expires_at,
    'resend_seconds', v_resend);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A correct code clears the count
-- ---------------------------------------------------------------------------

create or replace function public.otp_check(
  p_purpose   text,
  p_phone     text,
  p_user_id   uuid,
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant int := 5;
  v_row public.phone_otps;
begin
  select * into v_row
    from public.phone_otps
   where phone = p_phone
     and purpose = p_purpose
     and user_id is not distinct from p_user_id
     and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found or v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_row.code_hash = p_code_hash then
    update public.phone_otps set consumed_at = now() where id = v_row.id;
    -- Proved: start the count again from here.
    insert into public.otp_lockouts (phone, strikes, window_start, locked_until, last_strike_at)
    values (p_phone, 0, now(), null, null)
    on conflict (phone) do update
      set strikes = 0, window_start = now(), locked_until = null, last_strike_at = null;
    return jsonb_build_object('ok', true);
  end if;

  update public.phone_otps
     set attempts = attempts + 1,
         consumed_at = case when attempts + 1 >= c_max_attempts then now() end
   where id = v_row.id;

  if v_row.attempts + 1 >= c_max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'wrong',
    'attempts_left', c_max_attempts - (v_row.attempts + 1));
end;
$$;

-- `create or replace` keeps grants, but say it anyway: see the memory on
-- `create function` re-granting to PUBLIC.
revoke execute on function public.otp_issue(text, text, uuid, text, inet) from public, anon, authenticated;
revoke execute on function public.otp_check(text, text, uuid, text)       from public, anon, authenticated;
grant  execute on function public.otp_issue(text, text, uuid, text, inet) to service_role;
grant  execute on function public.otp_check(text, text, uuid, text)       to service_role;
