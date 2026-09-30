-- ============================================================================
-- A reason that already ends in a full stop is not given a second one.
--
-- Payout notifications append "." after the admin's reason and after the
-- payout reference. Admins (and PayLink's rejection reasons) usually end a
-- sentence with one already, so members read "...the account is new.." — found
-- in the PayLink joint test on 30 September 2026.
--
-- Both functions are copied verbatim from the live definitions
-- (pg_get_functiondef on sideperks-test, which carries every migration), and
-- the only change is rtrim(..., '. ') before the appended full stop.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_redemption_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if TG_OP = 'INSERT' then
    if NEW.status = 'held' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal request received',
        format('Your withdrawal of %s to %s has been received and is under review. We''ll let you know as soon as it''s approved.',
               v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status));
    end if;

    -- ---- and the operator hears about it ------------------------------
    -- Two separate switches because they answer different questions: "tell
    -- me money is being asked for" and "tell me this one looks wrong". An
    -- operator who has turned the routine one off still wants the second.
    if public.config_bool('alert_on_payout_request') then
      perform public.notify_admins(
        'payout',
        'Withdrawal requested',
        format('%s to %s is waiting for a decision.', v_money, v_dest),
        jsonb_build_object('redemption_id', NEW.id, 'user_id', NEW.user_id));
    end if;

    if NEW.risk_level_at_request in ('high', 'critical')
       and public.config_bool('alert_on_critical_risk') then
      perform public.notify_admins(
        'flag',
        'High-risk withdrawal',
        format('%s to %s was filed at %s risk.', v_money, v_dest, NEW.risk_level_at_request),
        jsonb_build_object('redemption_id', NEW.id, 'user_id', NEW.user_id,
                           'risk', NEW.risk_level_at_request));
    end if;

    return NEW;
  end if;

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
               coalesce(' Reference: ' || rtrim(NEW.external_reference, '. ') || '.', '')),
        jsonb_build_object('redemption_id', NEW.id, 'status', NEW.status,
                           'reference', NEW.external_reference));
    elsif NEW.status = 'rejected' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal not approved',
        format('Your withdrawal of %s could not be approved, so your points have been returned to your balance.%s',
               v_money,
               coalesce(' Reason: ' || rtrim(NEW.review_notes, '. ') || '.', '')),
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
$function$;

CREATE OR REPLACE FUNCTION public.notify_commission_payout_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
               coalesce(' Reference: ' || rtrim(NEW.external_reference, '. ') || '.', '')),
        jsonb_build_object('commission_payout_id', NEW.id, 'status', NEW.status,
                           'reference', NEW.external_reference),
        'affiliate');

    elsif NEW.status::text = 'rejected' then
      perform public.create_notification(
        NEW.user_id, 'payout',
        'Withdrawal not approved',
        format('Your commission withdrawal of %s could not be approved, so the amount has been returned to your commission balance.%s',
               v_money,
               coalesce(' Reason: ' || rtrim(NEW.review_notes, '. ') || '.', '')),
        jsonb_build_object('commission_payout_id', NEW.id, 'status', NEW.status),
        'affiliate');
    end if;
    /* `cancelled` is the affiliate's own action. Telling somebody what they
       just did is noise, and the points side does not do it either. */
  end if;

  return NEW;
end;
$function$;

