-- ============================================================================
-- Migration 032 — Account deletion with a 15-day grace period
--
-- Requesting deletion does not delete anything. It schedules: the account is
-- erased 15 days later unless the person signs in, which cancels the request
-- outright (operator spec 2026-07-25). Signing in is the cancel gesture
-- precisely because it is the one thing a returning user does anyway.
--
-- WHAT "PERMANENTLY DELETED" CAN MEAN HERE
-- points_ledger, redemptions and subscription_payments all reference the user
-- with ON DELETE RESTRICT — deliberately, since migration 007: money history
-- is not allowed to vanish. So a user who has ever earned a point CANNOT be
-- row-deleted without tearing a hole in the ledger that funded real payouts.
--
-- Deletion therefore takes whichever form is honest for that account:
--   * no financial history  -> the row really is deleted, and cascades take
--                              every dependent record with it.
--   * any financial history -> the PERSON is erased (name, phone, avatar,
--                              payout destinations, PIN, 2FA secret, devices)
--                              and the anonymous ledger rows remain. The login
--                              is scrambled and banned, so nobody can sign in.
--
-- Either way the identity is recorded in blocked_identities so the same email
-- or phone cannot register again. Only SHA-256 hashes are kept: enough to
-- refuse a repeat signup, useless for reconstructing who left.
-- ============================================================================

alter table public.profiles
  add column deletion_requested_at timestamptz,
  add column deletion_effective_at timestamptz,
  add column deleted_at            timestamptz;

comment on column public.profiles.deletion_requested_at is
  'When the user asked for deletion. Null = no request pending.';
comment on column public.profiles.deletion_effective_at is
  'When the purge becomes due (request + 15 days). Signing in clears both.';
comment on column public.profiles.deleted_at is
  'Set once the account has actually been purged or anonymised. Terminal.';

-- Finds the accounts the scheduled job must act on.
create index profiles_deletion_due_idx
  on public.profiles (deletion_effective_at)
  where deletion_effective_at is not null and deleted_at is null;


-- Identities that may never register again. ----------------------------------
create table public.blocked_identities (
  id          uuid primary key default gen_random_uuid(),
  email_hash  text not null,
  phone_hash  text,
  reason      text not null default 'account_deleted',
  blocked_at  timestamptz not null default now()
);

comment on table public.blocked_identities is
  'SHA-256 hashes of the email/phone of deleted accounts. Hashes only: enough to refuse a repeat signup, useless for identifying anyone.';

create unique index blocked_identities_email_idx on public.blocked_identities (email_hash);
create unique index blocked_identities_phone_idx on public.blocked_identities (phone_hash)
  where phone_hash is not null;

alter table public.blocked_identities enable row level security;
-- No policies: readable only through the SECURITY DEFINER check below, so the
-- table can never be harvested as a list of "people who left".
revoke all on public.blocked_identities from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Normalisation. A Ghanaian number is written 024 123 4567 or +233 24 123 4567
-- for the same phone; without folding those together the block would be a
-- formatting trivia quiz.
-- ---------------------------------------------------------------------------
create or replace function public.normalise_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare v_digits text;
begin
  if p_phone is null then return null; end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if v_digits = '' then return null; end if;
  -- +233 24… and 024… are the same line.
  if length(v_digits) = 12 and left(v_digits, 3) = '233' then
    v_digits := '0' || substr(v_digits, 4);
  end if;
  return v_digits;
end;
$$;

create or replace function public.identity_hash(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    else encode(extensions.digest(lower(btrim(p_value)), 'sha256'), 'hex')
  end;
$$;


-- ---------------------------------------------------------------------------
-- Request / cancel / status
-- ---------------------------------------------------------------------------
create or replace function public.request_account_deletion(p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row      public.profiles;
  v_effective timestamptz := now() + interval '15 days';
begin
  select * into v_row from public.profiles where id = p_user_id;
  if v_row.id is null then
    raise exception 'No such account' using errcode = 'no_data_found';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'This account is already deleted' using errcode = 'check_violation';
  end if;

  update public.profiles
     set deletion_requested_at = coalesce(deletion_requested_at, now()),
         deletion_effective_at = coalesce(deletion_effective_at, v_effective),
         updated_at            = now()
   where id = p_user_id
   returning deletion_effective_at into v_effective;

  return v_effective;
end;
$$;


/**
 * Cancel a pending request. Called on every sign-in, so it must be cheap and
 * silent when there is nothing to cancel — the return value tells the caller
 * whether anything actually happened, which is what decides whether the user
 * is told "welcome back, your deletion was called off".
 */
create or replace function public.cancel_account_deletion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare v_had boolean;
begin
  select deletion_requested_at is not null into v_had
    from public.profiles where id = p_user_id;

  if not coalesce(v_had, false) then return false; end if;

  update public.profiles
     set deletion_requested_at = null,
         deletion_effective_at = null,
         updated_at            = now()
   where id = p_user_id and deleted_at is null;

  return true;
end;
$$;


/** Self-scoped status for the UI. Carries no secret. */
create or replace function public.get_deletion_status()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.profiles;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_row from public.profiles where id = v_user;

  return jsonb_build_object(
    'pending',      v_row.deletion_requested_at is not null and v_row.deleted_at is null,
    'requested_at', v_row.deletion_requested_at,
    'effective_at', v_row.deletion_effective_at,
    'days_left',    case
                      when v_row.deletion_effective_at is null then null
                      else greatest(0, ceil(extract(epoch from (v_row.deletion_effective_at - now())) / 86400)::int)
                    end
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- Signup gate
-- ---------------------------------------------------------------------------
create or replace function public.is_identity_blocked(p_email text, p_phone text)
returns boolean
language sql
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.blocked_identities
     where email_hash = public.identity_hash(p_email)
        or (phone_hash is not null
            and phone_hash = public.identity_hash(public.normalise_phone(p_phone)))
  );
$$;


-- ---------------------------------------------------------------------------
-- The purge itself
-- ---------------------------------------------------------------------------
create or replace function public.due_account_deletions()
returns table (user_id uuid)
language sql
security definer
set search_path to ''
as $$
  select id from public.profiles
   where deletion_effective_at is not null
     and deleted_at is null
     and deletion_effective_at <= now();
$$;


/**
 * Erase the account. Blocks the identity first, so a crash between the two
 * halves leaves the identity blocked rather than silently reusable.
 *
 * Returns how it was carried out, because the two outcomes are genuinely
 * different and the operator will need to reason about them: 'deleted' means
 * the row is gone, 'anonymised' means the person is gone but the ledger rows
 * that paid out real money remain.
 */
create or replace function public.finalise_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_email     text;
  v_phone     text;
  v_financial boolean;
begin
  select u.email, p.phone into v_email, v_phone
    from auth.users u join public.profiles p on p.id = u.id
   where u.id = p_user_id;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Block the identity first: this must survive even a partial purge.
  insert into public.blocked_identities (email_hash, phone_hash)
  values (public.identity_hash(v_email),
          public.identity_hash(public.normalise_phone(v_phone)))
  on conflict do nothing;

  select exists (select 1 from public.points_ledger where user_id = p_user_id)
      or exists (select 1 from public.redemptions where user_id = p_user_id)
      or exists (select 1 from public.subscription_payments where user_id = p_user_id)
    into v_financial;

  if not v_financial then
    -- Nothing to preserve: really delete, and let the cascades do their work.
    delete from auth.users where id = p_user_id;
    return jsonb_build_object('ok', true, 'outcome', 'deleted');
  end if;

  -- Money history exists (ON DELETE RESTRICT, by design). Erase the person and
  -- keep the anonymous rows.
  delete from public.user_payout_details where user_id = p_user_id;
  delete from public.user_backup_codes   where user_id = p_user_id;
  delete from public.user_security       where user_id = p_user_id;
  delete from public.user_devices        where user_id = p_user_id;
  delete from public.notifications       where user_id = p_user_id;

  /*
    full_name and referral_code are NOT NULL, so they take dead placeholders
    rather than nulls. The referral code is retired to a value nobody can type
    (and that stays unique), so a deleted account can never be credited with
    another signup.
  */
  update public.profiles
     set full_name       = 'Deleted user',
         phone           = null,
         avatar_path     = null,
         referral_code   = 'DELETED-' || p_user_id::text,
         disabled_at     = coalesce(disabled_at, now()),
         disabled_reason = 'Account deleted at the user''s request',
         deleted_at      = now(),
         updated_at      = now()
   where id = p_user_id;

  -- Scramble the login so the address is unusable and cannot be signed into.
  update auth.users
     set email             = 'deleted+' || p_user_id::text || '@deleted.invalid',
         phone             = null,
         encrypted_password = null,
         email_confirmed_at = null,
         raw_user_meta_data = '{}'::jsonb,
         banned_until      = 'infinity'::timestamptz,
         updated_at        = now()
   where id = p_user_id;

  return jsonb_build_object('ok', true, 'outcome', 'anonymised');
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants. Only the self-scoped status read is reachable from a client.
-- ---------------------------------------------------------------------------
revoke execute on function public.request_account_deletion(uuid)      from anon, authenticated;
revoke execute on function public.cancel_account_deletion(uuid)       from anon, authenticated;
revoke execute on function public.finalise_account_deletion(uuid)     from anon, authenticated;
revoke execute on function public.due_account_deletions()             from anon, authenticated;
revoke execute on function public.is_identity_blocked(text, text)     from anon, authenticated;

grant execute on function public.get_deletion_status() to authenticated;
