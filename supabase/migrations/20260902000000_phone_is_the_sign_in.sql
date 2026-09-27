-- =============================================================================
-- The phone number becomes the sign-in, proved by an SMS code.
-- =============================================================================
--
-- Operator direction 2026-09-27: phone numbers replace email for verification,
-- and a password change needs a code sent by SMS. Every existing account must
-- prove a phone before it can use the app again.
--
-- WHY THE CODES LIVE HERE AND NOT IN SUPABASE AUTH. The SMS gateway (mNotify,
-- "BMS") only SENDS messages; it has no verify endpoint. Supabase's own phone
-- auth could generate the codes, but only through a Send SMS hook configured on
-- the project, and a failing auth hook is exactly what took every sign-in down
-- on 2026-07-31. So GoTrue is left alone: accounts keep an email identity
-- underneath (a generated one for phone-only signups), the app resolves a phone
-- to that account, and the codes are issued and checked by the two functions
-- below.
--
-- Nothing here stores a code. The application sends an HMAC of it, keyed with a
-- server secret the database never sees, so a dump of this table cannot be
-- replayed into a sign-in.

-- ---------------------------------------------------------------------------
-- 1. The verified phone, on the profile
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

comment on column public.profiles.phone_verified_at is
  'When the owner proved this phone with an SMS code. Null means profiles.phone is only what they typed, and the account is held on the verify screen.';

-- One verified owner per number. Unverified numbers may repeat (two accounts
-- already share one), and settle it when the second tries to prove it.
create unique index if not exists profiles_verified_phone_key
  on public.profiles (phone)
  where phone_verified_at is not null;

-- The phone is now a credential. Members could write it freely from the
-- personal details screen (migration 030); a credential moves only through the
-- server, after a code.
revoke update (phone) on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 2. The codes
-- ---------------------------------------------------------------------------

create table if not exists public.phone_otps (
  id           uuid primary key default gen_random_uuid(),
  purpose      text not null check (purpose in
                 ('signup', 'verify_phone', 'reset_password', 'change_password', 'change_phone')),
  phone        text not null,
  user_id      uuid references auth.users (id) on delete cascade,
  code_hash    text not null,
  attempts     int  not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  ip           inet,
  created_at   timestamptz not null default now()
);

create index if not exists phone_otps_phone_recent_idx
  on public.phone_otps (phone, created_at desc);

alter table public.phone_otps enable row level security;
-- No policies: nobody but the service role reads or writes a code.
revoke all on public.phone_otps from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The knobs (operator-configurable, per the delegation rule)
-- ---------------------------------------------------------------------------

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('phone_verification_required', 'true', 'bool', null, null, false,
   'Every member must prove a phone number by SMS before using the app. Off lets unverified accounts in, for an emergency such as the SMS gateway being down.'),
  ('otp_ttl_minutes', '10', 'int', 2, 60, false,
   'How long an SMS code stays valid, in minutes.'),
  ('otp_resend_seconds', '60', 'int', 30, 600, false,
   'How long someone waits before asking for another SMS code for the same number.'),
  ('otp_hourly_limit', '5', 'int', 1, 20, false,
   'The most SMS codes one phone number can be sent in an hour, across every purpose. Each one costs money.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Issuing a code
-- ---------------------------------------------------------------------------
--
-- Atomic per number (advisory lock), so two taps cannot both pass the cooldown.
-- A new code for the same purpose retires the previous one: only the latest SMS
-- works, which is what somebody who pressed "resend" expects.

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
  v_ttl      int := coalesce((select value::int from public.app_config where key = 'otp_ttl_minutes'), 10);
  v_resend   int := coalesce((select value::int from public.app_config where key = 'otp_resend_seconds'), 60);
  v_limit    int := coalesce((select value::int from public.app_config where key = 'otp_hourly_limit'), 5);
  v_last     timestamptz;
  v_count    int;
  v_oldest   timestamptz;
  v_row      public.phone_otps;
begin
  perform pg_advisory_xact_lock(hashtext('phone_otp:' || p_phone));

  select max(created_at) into v_last
    from public.phone_otps
   where phone = p_phone and purpose = p_purpose;

  if v_last is not null and v_last > now() - make_interval(secs => v_resend) then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retry_after', v_last + make_interval(secs => v_resend));
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from public.phone_otps
   where phone = p_phone and created_at > now() - interval '1 hour';

  if v_count >= v_limit then
    return jsonb_build_object('ok', false, 'reason', 'limit',
      'retry_after', v_oldest + interval '1 hour');
  end if;

  update public.phone_otps
     set consumed_at = now()
   where phone = p_phone and purpose = p_purpose and consumed_at is null;

  insert into public.phone_otps (purpose, phone, user_id, code_hash, expires_at, ip)
  values (p_purpose, p_phone, p_user_id, p_code_hash, now() + make_interval(mins => v_ttl), p_ip)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'expires_at', v_row.expires_at,
    'resend_seconds', v_resend);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Checking a code
-- ---------------------------------------------------------------------------
--
-- Five wrong tries retire the code. A code issued for one purpose, number or
-- account never answers for another, so a signup code cannot reset a password.

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

-- ---------------------------------------------------------------------------
-- 6. Lookups the sign-in needs
-- ---------------------------------------------------------------------------

-- The account a verified phone signs in to, and the email identity GoTrue
-- knows it by. Null when no account has proved this number.
create or replace function public.account_for_phone(p_phone text)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.phone = public.normalise_phone(p_phone)
     and p.phone_verified_at is not null
   limit 1;
$$;

-- The account behind an email, and whether it has moved to phone sign-in.
-- Used to refuse the old email route once a phone is proved.
create or replace function public.account_for_email(p_email text)
returns table (user_id uuid, phone_verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, p.phone_verified_at is not null
    from auth.users u
    join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim(p_email))
   limit 1;
$$;

-- Ends every session an account has. A password reset done from a code has no
-- session of its own to keep, so `revoke_other_sessions` does not fit.
create or replace function public.revoke_all_sessions(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted int;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ⚠️ `create function` grants EXECUTE to PUBLIC, which includes the anon key.
-- Every function above is for the server only.
revoke execute on function public.otp_issue(text, text, uuid, text, inet) from public, anon, authenticated;
revoke execute on function public.otp_check(text, text, uuid, text)       from public, anon, authenticated;
revoke execute on function public.account_for_phone(text)                 from public, anon, authenticated;
revoke execute on function public.account_for_email(text)                 from public, anon, authenticated;
revoke execute on function public.revoke_all_sessions(uuid)               from public, anon, authenticated;

grant execute on function public.otp_issue(text, text, uuid, text, inet) to service_role;
grant execute on function public.otp_check(text, text, uuid, text)       to service_role;
grant execute on function public.account_for_phone(text)                 to service_role;
grant execute on function public.account_for_email(text)                 to service_role;
grant execute on function public.revoke_all_sessions(uuid)               to service_role;
