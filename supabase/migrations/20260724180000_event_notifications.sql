-- ============================================================================
-- Migration 028 — Event-driven notifications (tier announcements + flagging)
--
-- Extends the automated notification catalogue (payouts already wired in 027):
--
--   * broadcast_notification(...) — server-only primitive that fans a
--     notification out to every non-disabled user. Reused by the tier
--     announcement below and, later, by the admin dashboard's "send a custom
--     notification to everyone" action.
--
--   * A new plan going live -> an announcement to ALL users. Fires when a tier
--     is inserted already active, OR when a draft tier is published (is_active
--     flips false->true). The default (free) tier and inactive drafts are
--     silent.
--
--   * An account being flagged/disabled by an admin -> a red "flag"
--     notification to that user carrying the admin's reason (e.g. multiple
--     accounts from one device, or one account signed in across many devices).
--     The flag card's "Contact support" is the user's route back.
--
-- Single-user custom notifications already have their primitive
-- (create_notification). All of these are DB-level so the notification is
-- guaranteed by the data event, however it was triggered — the admin UI that
-- drives tiers/flagging is a later, design-gated build.
--
-- Applied to the live project via the Supabase MCP on 2026-07-24; this file is
-- the repo record of that change.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Fan-out primitive: one notification per active user. Server-only.
-- --------------------------------------------------------------------------
create or replace function public.broadcast_notification(
  p_type      public.notification_type,
  p_title     text,
  p_body      text,
  p_reference jsonb default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.notifications (user_id, type, title, body, reference)
  select id, p_type, p_title, p_body, p_reference
    from public.profiles
   where disabled_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.broadcast_notification(public.notification_type, text, text, jsonb)
  from public, anon, authenticated;


-- --------------------------------------------------------------------------
-- A plan going live -> announce to everyone.
-- --------------------------------------------------------------------------
create or replace function public.notify_new_tier()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only real, public plans: skip the default free tier and inactive drafts.
  if NEW.is_default or not NEW.is_active then
    return NEW;
  end if;
  -- On UPDATE, announce only the moment it BECOMES active (draft -> published),
  -- never on later edits to an already-live plan.
  if TG_OP = 'UPDATE' and OLD.is_active then
    return NEW;
  end if;

  perform public.broadcast_notification(
    'announcement',
    'New plan available',
    format('A new plan, %s, is now available. Open the Upgrade tab to see what''s included.', NEW.name),
    jsonb_build_object('tier_id', NEW.id, 'tier_slug', NEW.slug));

  return NEW;
end;
$$;

revoke execute on function public.notify_new_tier() from public, anon, authenticated;

create trigger trg_notify_new_tier
  after insert or update of is_active on public.tiers
  for each row execute function public.notify_new_tier();


-- --------------------------------------------------------------------------
-- Account flagged/disabled by an admin -> flag notification to that user.
-- Fires the moment disabled_at goes from null to set.
-- --------------------------------------------------------------------------
create or replace function public.notify_account_flagged()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.create_notification(
    NEW.id, 'flag',
    'Your account has been flagged',
    coalesce(
      nullif(trim(NEW.disabled_reason), ''),
      'Your account has been flagged for review because of unusual activity.'
    ) || ' If you believe this is a mistake, contact support.',
    jsonb_build_object('disabled_at', NEW.disabled_at, 'reason', NEW.disabled_reason));
  return NEW;
end;
$$;

revoke execute on function public.notify_account_flagged() from public, anon, authenticated;

create trigger trg_notify_account_flagged
  after update of disabled_at on public.profiles
  for each row
  when (OLD.disabled_at is null and NEW.disabled_at is not null)
  execute function public.notify_account_flagged();
