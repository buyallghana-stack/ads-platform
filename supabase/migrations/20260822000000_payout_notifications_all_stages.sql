-- ---------------------------------------------------------------------------
-- Commission payouts notify at every stage the points payouts do, and the
-- operator's own alerts start arriving at all.
--
-- Operator, 2026-08-08: "the payout notification across all stages should
-- imitate the ads but make sure it doesnt go to where it doesnt belong to."
--
-- The commission side had three stages (approved, paid, rejected) with generic
-- wording and nothing at all when a request was filed. The points side has
-- five moments and says the amount and the destination in every one of them.
-- ---------------------------------------------------------------------------

-- ── 1. `notify_admins` HAS BEEN NOTIFYING NOBODY ──────────────────────────
--
-- ⚠️ IT FILTERS `role = 'admin'` AND NOT ONE ACCOUNT HOLDS THAT ROLE. The
-- value exists in the `app_role` enum, so nothing errors and nothing warns;
-- the query simply matches zero rows. The platform's actual administrator is
-- `super_admin`.
--
-- So every "Withdrawal requested" alert, every high-risk flag and every other
-- admin notification since the roles were split has been written for an empty
-- set. The switch `alert_on_payout_request` is on, and has been doing nothing.
--
-- This is the same trap recorded when the roles were introduced: five copies
-- of a query asked for the literal 'admin' and all five went quiet when that
-- row was renamed. This was the sixth.
create or replace function public.notify_admins(
  p_type  public.notification_type,
  p_title text,
  p_body  text,
  p_data  jsonb default '{}'::jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_count int := 0;
begin
  /* Both roles that can act on an alert. `support` is left out on purpose:
     these are money and risk decisions, and a support agent cannot make them,
     so it would be an inbox they can only watch fill up. */
  perform public.create_notification(
            r.user_id, p_type, p_title, p_body, p_data,
            /* Operational alerts belong to the ACCOUNT, not to a business.
               An operator looking at the affiliate marketplace still needs to
               hear that a points withdrawal is waiting. */
            'both'
          )
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
   where r.role in ('admin', 'super_admin')
     and p.deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.notify_admins(public.notification_type, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.notify_admins(public.notification_type, text, text, jsonb) to service_role;

-- ── 2. Every stage of a commission payout ─────────────────────────────────

create or replace function public.notify_commission_payout_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_money text;
  v_dest  text;
begin
  /* ⚠️ CRYPTO IS DENOMINATED IN THE COIN, not in cedis — the operator's locked
     rule. The coin amount is frozen on the row at request time, so this is
     what will actually be sent whatever the price does in between. Quoting a
     cedi figure against a USDT payout describes a transfer that never happens
     in cedis. */
  v_money := case
    when NEW.method::text = 'crypto' and NEW.coin_amount is not null then
      to_char(NEW.coin_amount, 'FM999999990.00######') || ' ' ||
      coalesce(NEW.snapshot_coin_code, 'USDT')
    else
      'GHS ' || to_char(coalesce(NEW.net_minor, NEW.amount_minor) / 100.0, 'FM999999990.00')
  end;

  v_dest := case NEW.method::text
    when 'crypto' then
      coalesce(NEW.snapshot_coin_code, 'crypto')
      || coalesce(' (' || NEW.snapshot_network_code || ')', '')
    else
      coalesce(NEW.snapshot_provider_code, 'Mobile Money')
  end;

  -- ---- filed --------------------------------------------------------------
  if TG_OP = 'INSERT' then
    if NEW.status::text = 'requested' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal request received',
        format('Your commission withdrawal of %s to %s has been received and is under review. We will let you know as soon as it is approved.',
               v_money, v_dest),
        jsonb_build_object('commission_payout_id', NEW.id, 'status', NEW.status),
        /* ⚠️ THE WHOLE POINT OF THE OPERATOR'S NOTE. This is commission, so it
           belongs in the affiliate bell and nowhere else. A cedis withdrawal
           announcing itself on the points side is the bug being fixed. */
        'affiliate');
    end if;

    /* The operator hears about it too, on the same switch the points side
       uses — one answer to "tell me money is being asked for", whichever
       business is asking. */
    if public.config_bool('alert_on_payout_request') then
      perform public.notify_admins(
        'payout',
        'Commission withdrawal requested',
        format('%s to %s is waiting for a decision.', v_money, v_dest),
        jsonb_build_object('commission_payout_id', NEW.id, 'user_id', NEW.user_id));
    end if;

    return NEW;
  end if;

  -- ---- decided ------------------------------------------------------------
  if NEW.status is distinct from OLD.status then
    if NEW.status::text = 'approved' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal approved',
        format('Your commission withdrawal of %s to %s has been approved and is being processed.',
               v_money, v_dest),
        jsonb_build_object('commission_payout_id', NEW.id, 'status', NEW.status),
        'affiliate');

    elsif NEW.status::text = 'paid' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal sent',
        format('Your commission withdrawal of %s to %s has been sent.%s',
               v_money, v_dest,
               coalesce(' Reference: ' || NEW.external_reference || '.', '')),
        jsonb_build_object('commission_payout_id', NEW.id, 'status', NEW.status,
                           'reference', NEW.external_reference),
        'affiliate');

    elsif NEW.status::text = 'rejected' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal not approved',
        format('Your commission withdrawal of %s could not be approved, so the amount has been returned to your commission balance.%s',
               v_money,
               coalesce(' Reason: ' || NEW.review_notes || '.', '')),
        jsonb_build_object('commission_payout_id', NEW.id, 'status', NEW.status),
        'affiliate');
    end if;
    /* `cancelled` is the affiliate's own action. Telling somebody what they
       just did is noise, and the points side does not do it either. */
  end if;

  return NEW;
end;
$$;

/* ⚠️ THE TRIGGER HAS TO FIRE ON INSERT NOW, not only on an update of status.
   The old one was `after update of status`, so the "request received" branch
   added above could never have run. */
drop trigger if exists commission_payouts_notify on public.commission_payouts;
create trigger commission_payouts_notify
  after insert or update of status on public.commission_payouts
  for each row execute function public.notify_commission_payout_status();

revoke execute on function public.notify_commission_payout_status() from public, anon, authenticated;
