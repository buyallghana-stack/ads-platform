-- ============================================================================
-- Migration 029 — Softer account flag (flagged, but not disabled)
--
-- Operator decision (2026-07-24): flagging should be a SOFT state — a warning
-- that the account is under review — distinct from a full disable. So this
-- adds flagged_at / flagged_reason / flagged_by alongside the existing
-- disabled_* columns, and moves the flag notification onto the soft flag.
--
--   flag    account stays usable; the user is warned and pointed at support.
--   disable (unchanged) the harsher restriction handled elsewhere; blocks
--           payouts etc. No notification is attached to disable here.
--
-- flag_user_account / clear_user_flag are the server-only entry points the
-- admin dashboard will call; the notification is emitted by the trigger the
-- moment flagged_at goes null -> set, so it is guaranteed by the data event.
--
-- Applied to the live project via the Supabase MCP on 2026-07-24; this file is
-- the repo record of that change.
-- ============================================================================

alter table public.profiles
  add column flagged_at     timestamptz,
  add column flagged_reason text,
  add column flagged_by     uuid;

comment on column public.profiles.flagged_at is
  'When the account was soft-flagged for review. Distinct from disabled_at: a flagged account stays usable. Null = not flagged.';


-- Move the flag notification off disabled_at and onto the soft flag.
drop trigger if exists trg_notify_account_flagged on public.profiles;

create or replace function public.notify_account_flagged()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.create_notification(
    NEW.id, 'flag',
    'Your account has been flagged',
    coalesce(
      nullif(trim(NEW.flagged_reason), ''),
      'Your account has been flagged for review because of unusual activity.'
    ) || ' You can keep using SidePerks. If you believe this is a mistake, contact support.',
    jsonb_build_object('flagged_at', NEW.flagged_at, 'reason', NEW.flagged_reason));
  return NEW;
end;
$$;

revoke execute on function public.notify_account_flagged() from public, anon, authenticated;

create trigger trg_notify_account_flagged
  after update of flagged_at on public.profiles
  for each row
  when (OLD.flagged_at is null and NEW.flagged_at is not null)
  execute function public.notify_account_flagged();


-- --------------------------------------------------------------------------
-- Admin entry points (server-only). Called by the admin service client with
-- the acting admin's id, mirroring the redemption-review functions.
-- --------------------------------------------------------------------------
create or replace function public.flag_user_account(p_admin_id uuid, p_user_id uuid, p_reason text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_out public.profiles;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A flag reason is required' using errcode = 'check_violation';
  end if;

  update public.profiles
     set flagged_at = now(), flagged_reason = trim(p_reason),
         flagged_by = p_admin_id, updated_at = now()
   where id = p_user_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;

create or replace function public.clear_user_flag(p_admin_id uuid, p_user_id uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_out public.profiles;
begin
  update public.profiles
     set flagged_at = null, flagged_reason = null, flagged_by = null, updated_at = now()
   where id = p_user_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  return v_out;
end;
$$;

revoke execute on function public.flag_user_account(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.clear_user_flag(uuid, uuid)         from public, anon, authenticated;
