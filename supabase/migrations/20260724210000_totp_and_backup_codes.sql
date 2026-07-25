-- ============================================================================
-- Migration 031 — Two-factor authentication (TOTP) + backup codes
--
-- Opt-in 2FA via an authenticator app (Google Authenticator et al), chosen by
-- the operator over emailed codes: no per-message cost, and it works offline
-- on a Ghanaian phone with no credit. Backup codes are MANDATORY at enrolment
-- so losing the phone is not losing the account; account email remains the
-- last-resort recovery path (operator decision 2026-07-24).
--
-- Secret handling mirrors the withdrawal PIN (migration 20260724150000):
--   * user_security has NO client RLS read policy. Everything here is reached
--     solely through SECURITY DEFINER functions REVOKED from client roles and
--     called with the service-role client, with the user id taken from the
--     verified session — never from a payload.
--   * The TOTP secret cannot be hashed (verification needs the original), so
--     it is stored ENCRYPTED — AES-256-GCM, keyed by TOTP_SECRET_KEY which
--     lives only in the server environment. A database dump alone therefore
--     does not yield anyone's second factor.
--   * Backup codes ARE hashed (bcrypt, like the PIN); they are shown to the
--     user exactly once, at generation.
--
-- Verification attempts are rate limited on the same terms the PIN uses:
-- 5 wrong codes -> 15 minute lock. A 6-digit code is brute-forceable in
-- roughly a million guesses, so an unlimited endpoint would be the weakest
-- link in the whole account.
-- ============================================================================

alter table public.user_security
  add column totp_secret_cipher   text,
  add column totp_confirmed_at    timestamptz,
  add column totp_failed_attempts integer not null default 0,
  add column totp_locked_until    timestamptz;

comment on column public.user_security.totp_secret_cipher is
  'AES-256-GCM ciphertext of the base32 TOTP secret. Decryptable only by the app server (TOTP_SECRET_KEY). Present but unconfirmed = enrolment in progress.';
comment on column public.user_security.totp_confirmed_at is
  'Set once the user proves possession with a valid code. Non-null = 2FA is ON.';


-- Backup codes: one row per code, bcrypt-hashed, single use. -----------------
create table public.user_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.user_backup_codes is
  'Single-use 2FA recovery codes, bcrypt-hashed. Shown to the user once at generation and never again.';

create index user_backup_codes_unused_idx
  on public.user_backup_codes (user_id) where used_at is null;

alter table public.user_backup_codes enable row level security;
-- Deliberately NO policies: not even the owner may read their own hashes.
-- Every access path is a SECURITY DEFINER function below.
revoke all on public.user_backup_codes from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Self-scoped status read. Safe for the client: it carries no secret and no
-- hash, only whether 2FA is on and how many codes remain.
-- ---------------------------------------------------------------------------
create or replace function public.get_totp_status()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user      uuid := auth.uid();
  v_row       public.user_security;
  v_remaining int;
  v_total     int;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_row from public.user_security where user_id = v_user;

  select count(*) filter (where used_at is null), count(*)
    into v_remaining, v_total
    from public.user_backup_codes where user_id = v_user;

  return jsonb_build_object(
    'enabled',                v_row.totp_confirmed_at is not null,
    'pending',                v_row.totp_secret_cipher is not null
                                and v_row.totp_confirmed_at is null,
    'confirmed_at',           v_row.totp_confirmed_at,
    'backup_codes_remaining', coalesce(v_remaining, 0),
    'backup_codes_total',     coalesce(v_total, 0)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- Enrolment. Storing a fresh secret always clears any previous confirmation:
-- restarting setup must not leave the OLD authenticator working.
-- ---------------------------------------------------------------------------
create or replace function public.start_totp_enrollment(p_user_id uuid, p_cipher text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.user_security
    (user_id, totp_secret_cipher, totp_confirmed_at, totp_failed_attempts, totp_locked_until, updated_at)
  values
    (p_user_id, p_cipher, null, 0, null, now())
  on conflict (user_id) do update
    set totp_secret_cipher   = excluded.totp_secret_cipher,
        totp_confirmed_at    = null,
        totp_failed_attempts = 0,
        totp_locked_until    = null,
        updated_at           = now();
end;
$$;


/** Activate 2FA. Refuses unless an enrolment secret is actually present. */
create or replace function public.confirm_totp_enrollment(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_row public.user_security;
begin
  select * into v_row from public.user_security where user_id = p_user_id;
  if v_row.totp_secret_cipher is null then
    raise exception 'No enrolment in progress' using errcode = 'check_violation';
  end if;

  update public.user_security
     set totp_confirmed_at    = coalesce(totp_confirmed_at, now()),
         totp_failed_attempts = 0,
         totp_locked_until    = null,
         updated_at           = now()
   where user_id = p_user_id;
end;
$$;


/** The ciphertext, for the app server to decrypt and verify against. */
create or replace function public.get_totp_secret_cipher(p_user_id uuid)
returns text
language sql
security definer
set search_path to ''
as $$
  select totp_secret_cipher from public.user_security where user_id = p_user_id;
$$;


/**
 * Turn 2FA off completely. Backup codes go with it — they exist only to
 * recover this factor, and leaving them behind would be a live credential for
 * a factor the user believes is gone.
 */
create or replace function public.disable_totp(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.user_security
     set totp_secret_cipher   = null,
         totp_confirmed_at    = null,
         totp_failed_attempts = 0,
         totp_locked_until    = null,
         updated_at           = now()
   where user_id = p_user_id;

  delete from public.user_backup_codes where user_id = p_user_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Attempt throttling. The code itself is checked in Node (the secret is
-- encrypted there); the DB owns only the counter, so the lock cannot be
-- sidestepped by a caller that skips the check.
-- ---------------------------------------------------------------------------
create or replace function public.totp_lock_state(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.user_security;
  v_max int := 5;
begin
  select * into v_row from public.user_security where user_id = p_user_id;

  if v_row.totp_locked_until is not null and now() < v_row.totp_locked_until then
    return jsonb_build_object('locked', true, 'retry_after', v_row.totp_locked_until);
  end if;
  return jsonb_build_object(
    'locked', false,
    'attempts_left', greatest(v_max - coalesce(v_row.totp_failed_attempts, 0), 0)
  );
end;
$$;


/** Record a wrong code; lock at the ceiling. Returns the resulting state. */
create or replace function public.register_totp_failure(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row  public.user_security;
  v_max  int := 5;
  v_lock interval := interval '15 minutes';
begin
  update public.user_security
     set totp_failed_attempts = totp_failed_attempts + 1,
         totp_locked_until = case
           when totp_failed_attempts + 1 >= v_max then now() + v_lock
           else totp_locked_until end,
         updated_at = now()
   where user_id = p_user_id
   returning * into v_row;

  if v_row.totp_locked_until is not null and now() < v_row.totp_locked_until then
    return jsonb_build_object('locked', true, 'retry_after', v_row.totp_locked_until);
  end if;
  return jsonb_build_object(
    'locked', false,
    'attempts_left', greatest(v_max - v_row.totp_failed_attempts, 0)
  );
end;
$$;


/** Clear the counter after a correct code. */
create or replace function public.clear_totp_failures(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.user_security
     set totp_failed_attempts = 0, totp_locked_until = null, updated_at = now()
   where user_id = p_user_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Backup codes. Generated in Node, hashed here — plaintext never lands in a
-- column, and the app never holds a hash.
-- ---------------------------------------------------------------------------
create or replace function public.replace_backup_codes(p_user_id uuid, p_codes text[])
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare v_code text;
begin
  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'No codes supplied' using errcode = 'check_violation';
  end if;

  -- Regenerating invalidates every previous code, used or not.
  delete from public.user_backup_codes where user_id = p_user_id;

  foreach v_code in array p_codes loop
    insert into public.user_backup_codes (user_id, code_hash)
    values (p_user_id, extensions.crypt(v_code, extensions.gen_salt('bf')));
  end loop;

  return array_length(p_codes, 1);
end;
$$;


/**
 * Spend a backup code. bcrypt means we cannot look the code up by value, so
 * this walks the user's unused codes — at most ten rows, and only ever for
 * one user. The row is marked used inside the same statement that matched it,
 * so the same code cannot be spent twice concurrently.
 */
create or replace function public.consume_backup_code(p_user_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row       public.user_backup_codes;
  v_remaining int;
begin
  for v_row in
    select * from public.user_backup_codes
     where user_id = p_user_id and used_at is null
     for update
  loop
    if v_row.code_hash = extensions.crypt(p_code, v_row.code_hash) then
      update public.user_backup_codes
         set used_at = now()
       where id = v_row.id and used_at is null;

      select count(*) into v_remaining
        from public.user_backup_codes
       where user_id = p_user_id and used_at is null;

      return jsonb_build_object('ok', true, 'remaining', v_remaining);
    end if;
  end loop;

  return jsonb_build_object('ok', false);
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants. Only the secret-free status read is callable by a signed-in client;
-- everything else is server-only, exactly like the PIN functions.
-- ---------------------------------------------------------------------------
revoke execute on function public.start_totp_enrollment(uuid, text)   from anon, authenticated;
revoke execute on function public.confirm_totp_enrollment(uuid)       from anon, authenticated;
revoke execute on function public.get_totp_secret_cipher(uuid)        from anon, authenticated;
revoke execute on function public.disable_totp(uuid)                  from anon, authenticated;
revoke execute on function public.totp_lock_state(uuid)               from anon, authenticated;
revoke execute on function public.register_totp_failure(uuid)         from anon, authenticated;
revoke execute on function public.clear_totp_failures(uuid)           from anon, authenticated;
revoke execute on function public.replace_backup_codes(uuid, text[])  from anon, authenticated;
revoke execute on function public.consume_backup_code(uuid, text)     from anon, authenticated;

grant execute on function public.get_totp_status() to authenticated;
