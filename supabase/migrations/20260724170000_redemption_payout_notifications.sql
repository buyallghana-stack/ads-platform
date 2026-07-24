-- ============================================================================
-- Migration 027 — Payout notifications from the redemption pipeline
--
-- Wires REAL payout notifications: whenever a redemption moves through its
-- lifecycle, the user gets a green "payout" notification.
--
-- Done as an AFTER trigger on redemptions rather than by editing the five
-- money-critical redemption functions (request/approve/paid/failed/reject).
-- The trigger only READS the row and calls create_notification, so it cannot
-- affect the payout math, and it covers every path that changes status no
-- matter which function caused it.
--
-- Events that reach the user (status is the source of truth):
--   held      (on INSERT)  -> request received, under review
--   approved               -> approved, being processed
--   paid                   -> sent (with the external reference, if any)
--   rejected               -> rejected + reason; points were refunded
--   failed                 -> failed + reason; points were refunded
-- pending_approval (internal promotion) and cancelled (the user's own action)
-- deliberately produce no notification.
--
-- Destination text is the method/coin/provider only — never the wallet or
-- phone number, which a notification should not echo back.
--
-- Applied to the live project via the Supabase MCP on 2026-07-24; this file is
-- the repo record of that change.
-- ============================================================================

create or replace function public.notify_redemption_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_money text;
  v_dest  text;
begin
  v_money := trim(coalesce(NEW.currency_code, 'GHS')) || ' '
             || to_char(NEW.currency_amount, 'FM999999990.00');

  v_dest := case NEW.method
    when 'crypto' then
      coalesce(NEW.snapshot_coin_code, 'crypto')
      || coalesce(' (' || NEW.snapshot_network_code || ')', '')
    else
      coalesce(NEW.snapshot_provider_code, 'Mobile Money')
  end;

  -- New request lands in 'held'.
  if TG_OP = 'INSERT' then
    if NEW.status = 'held' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal request received',
        format('Your withdrawal of %s to %s has been received and is under review. We''ll let you know as soon as it''s approved.',
               v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    end if;
    return NEW;
  end if;

  -- Only act when the status actually changed.
  if NEW.status is distinct from OLD.status then
    if NEW.status = 'approved' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal approved',
        format('Your withdrawal of %s to %s has been approved and is being processed.',
               v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));

    elsif NEW.status = 'paid' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal sent',
        format('Your withdrawal of %s to %s has been sent.%s',
               v_money, v_dest,
               coalesce(' Reference: ' || NEW.external_reference || '.', '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status,
                           'reference', NEW.external_reference));

    elsif NEW.status = 'rejected' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal not approved',
        format('Your withdrawal of %s could not be approved, so your points have been returned to your balance.%s',
               v_money,
               coalesce(' Reason: ' || NEW.review_notes || '.', '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));

    elsif NEW.status = 'failed' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal failed',
        format('Your withdrawal of %s to %s could not be completed, so your points have been returned to your balance.%s',
               v_money, v_dest,
               coalesce(' ' || NEW.failure_reason, '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    end if;
  end if;

  return NEW;
end;
$$;

comment on function public.notify_redemption_status() is
  'AFTER trigger: emits a payout notification on redemption lifecycle changes (held/approved/paid/rejected/failed). Read-only w.r.t. the payout math.';

-- A trigger function is never called directly; it fires with the table
-- owner's context regardless of grants. Revoke EXECUTE so it is not exposed
-- as an RPC, matching the other privileged functions.
revoke execute on function public.notify_redemption_status() from public, anon, authenticated;

create trigger trg_notify_redemption_status
  after insert or update of status on public.redemptions
  for each row execute function public.notify_redemption_status();
