-- ============================================================================
-- Migration 025 — Withdrawal PIN
--
-- A 4-digit PIN confirms every payout. It is stored ONLY as a bcrypt hash,
-- never plaintext, in a table with no client read access — the hash is reached
-- solely through the SECURITY DEFINER functions below, which are revoked from
-- every client role and run via the service key from server code.
--
-- A 4-digit PIN is brute-forceable (10,000 combinations), so verification is
-- rate limited: after 5 wrong tries in a row the PIN locks for 15 minutes.
--
-- Changing the PIN requires the current one. A forgotten-PIN RESET goes through
-- reset_withdrawal_pin, which trusts that the SERVER has already re-verified
-- identity by another factor (the account password today; an authenticator app
-- once 2FA ships).
--
-- Applied to the live project via the Supabase MCP on 2026-07-24; this file is
-- the repo record of that change.
-- ============================================================================

create table public.user_security (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- bcrypt hash of the 4-digit PIN. Null means no PIN is set yet.
  pin_hash text,
  pin_set_at timestamptz,

  -- Brute-force guard.
  pin_failed_attempts int not null default 0 check (pin_failed_attempts >= 0),
  pin_locked_until    timestamptz,

  updated_at timestamptz not null default now()
);

comment on table public.user_security is
  'Per-user security secrets (withdrawal PIN hash). No client read policy — the hash is reached only through the SECURITY DEFINER functions here, never selected. Never stores plaintext.';

alter table public.user_security enable row level security;
-- Intentionally NO policies for anon/authenticated: the hash must never leave
-- the database. Every interaction is a function call running as the owner.


create or replace function public.has_withdrawal_pin(p_user_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.user_security
    where user_id = p_user_id and pin_hash is not null
  );
$$;


create or replace function public.set_withdrawal_pin(
  p_user_id uuid, p_new_pin text, p_current_pin text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.user_security;
begin
  if p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = 'check_violation';
  end if;

  select * into v_row from public.user_security where user_id = p_user_id;

  if v_row.pin_hash is not null then
    if p_current_pin is null
       or v_row.pin_hash <> extensions.crypt(p_current_pin, v_row.pin_hash) then
      raise exception 'Current PIN is incorrect' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.user_security
    (user_id, pin_hash, pin_set_at, pin_failed_attempts, pin_locked_until, updated_at)
  values
    (p_user_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf')), now(), 0, null, now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash,
        pin_set_at = now(),
        pin_failed_attempts = 0,
        pin_locked_until = null,
        updated_at = now();
end;
$$;


create or replace function public.reset_withdrawal_pin(p_user_id uuid, p_new_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = 'check_violation';
  end if;

  insert into public.user_security
    (user_id, pin_hash, pin_set_at, pin_failed_attempts, pin_locked_until, updated_at)
  values
    (p_user_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf')), now(), 0, null, now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash,
        pin_set_at = now(),
        pin_failed_attempts = 0,
        pin_locked_until = null,
        updated_at = now();
end;
$$;


create or replace function public.verify_withdrawal_pin(p_user_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row  public.user_security;
  v_max  int := 5;
  v_lock interval := interval '15 minutes';
begin
  select * into v_row from public.user_security where user_id = p_user_id for update;

  if v_row.pin_hash is null then
    return jsonb_build_object('ok', false, 'no_pin', true);
  end if;

  if v_row.pin_locked_until is not null and now() < v_row.pin_locked_until then
    return jsonb_build_object('ok', false, 'locked', true, 'retry_after', v_row.pin_locked_until);
  end if;

  if v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash) then
    update public.user_security
      set pin_failed_attempts = 0, pin_locked_until = null, updated_at = now()
     where user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;

  update public.user_security
    set pin_failed_attempts = pin_failed_attempts + 1,
        pin_locked_until = case
          when pin_failed_attempts + 1 >= v_max then now() + v_lock
          else pin_locked_until end,
        updated_at = now()
   where user_id = p_user_id
   returning * into v_row;

  if v_row.pin_locked_until is not null and now() < v_row.pin_locked_until then
    return jsonb_build_object('ok', false, 'locked', true, 'retry_after', v_row.pin_locked_until);
  end if;
  return jsonb_build_object('ok', false, 'attempts_left', greatest(v_max - v_row.pin_failed_attempts, 0));
end;
$$;


revoke execute on function public.has_withdrawal_pin(uuid)             from public, anon, authenticated;
revoke execute on function public.set_withdrawal_pin(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.reset_withdrawal_pin(uuid, text)     from public, anon, authenticated;
revoke execute on function public.verify_withdrawal_pin(uuid, text)    from public, anon, authenticated;
