-- ---------------------------------------------------------------------------
-- A notification belongs to one business, or to both.
--
-- Operator, 2026-08-07: "the affiliates and ads does not share notifications.
-- each activity that happen on both business are distinct."
--
-- They shared one bell. Somebody standing in the affiliate marketplace saw
-- "5,000 points have been added to your balance" — a sentence about the other
-- business, in the other business's units, on a screen where points do not
-- exist. D27 keeps the two ledgers apart and this is the same boundary: the
-- feed of what happened to you is part of the business it happened in.
--
-- ── WHY THERE IS A THIRD VALUE, `both` ──
--
-- Not everything belongs to a business. A reply from support, an account flag,
-- a platform announcement — those are about the ACCOUNT, and hiding a support
-- reply because you happened to be reading it in the wrong mode would be a
-- worse bug than the one being fixed. `both` shows in either bell, and the
-- read filter is `business in (current_mode, 'both')`.
--
-- ⚠️ `ads` IS THE DEFAULT, and that is deliberate rather than lazy. Every one
-- of the 29 existing call sites was written before this column existed, and
-- all but one of them is an ads event. A default of `both` would have quietly
-- put every points notification back into the affiliate bell, which is the
-- thing being removed.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_business') then
    create type public.notification_business as enum ('ads', 'affiliate', 'both');
  end if;
end $$;

alter table public.notifications
  add column if not exists business public.notification_business not null default 'ads';

create index if not exists notifications_user_business_idx
  on public.notifications (user_id, business, created_at desc);

-- ---------------------------------------------------------------------------
-- `create_notification` gains the argument.
--
-- ⚠️ THE OLD FIVE-ARGUMENT VERSION IS DROPPED FIRST. Adding a sixth parameter
-- with a default does NOT replace it, it creates an overload — and then every
-- existing five-argument call matches both candidates and Postgres refuses the
-- call as ambiguous. Twenty-nine call sites would have started failing at once.
-- ---------------------------------------------------------------------------

drop function if exists public.create_notification(uuid, public.notification_type, text, text, jsonb);

create or replace function public.create_notification(
  p_user_id   uuid,
  p_type      public.notification_type,
  p_title     text,
  p_body      text,
  p_reference jsonb default null,
  p_business  public.notification_business default 'ads'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.notifications (user_id, type, title, body, reference, business)
  values (p_user_id, p_type, p_title, p_body, p_reference, p_business)
  returning id into v_id;
  return v_id;
end;
$$;

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC, and the drop above threw
   away the old grants entirely. Both halves have to be restated. */
revoke execute on function public.create_notification(uuid, public.notification_type, text, text, jsonb, public.notification_business) from public, anon, authenticated;
grant execute on function public.create_notification(uuid, public.notification_type, text, text, jsonb, public.notification_business) to service_role;

-- ---------------------------------------------------------------------------
-- Reassign the events that are not ads events.
-- ---------------------------------------------------------------------------

/* The commission gift code pays cedis, so it is affiliate news. */
create or replace function public.redeem_commission_gift_code(
  p_user_id uuid,
  p_code    text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code   record;
  v_aff_id uuid;
begin
  select id into v_aff_id
    from public.affiliate_accounts
   where user_id = p_user_id;

  if v_aff_id is null then
    return jsonb_build_object('outcome', 'no_account');
  end if;

  select * into v_code
    from public.commission_gift_codes
   where upper(code) = upper(btrim(p_code))
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_code.status = 'redeemed' then
    return jsonb_build_object('outcome', 'already_used');
  end if;
  if v_code.status = 'revoked' then
    return jsonb_build_object('outcome', 'revoked');
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired');
  end if;

  begin
    insert into public.commission_gift_code_redemptions
      (gift_code_id, affiliate_id, user_id, amount_minor)
    values (v_code.id, v_aff_id, p_user_id, v_code.amount_minor);
  exception when unique_violation then
    return jsonb_build_object('outcome', 'already_used');
  end;

  insert into public.commission_ledger
    (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
  values (
    v_aff_id, 'adjustment', v_code.amount_minor, 'cleared',
    'Gift code ' || v_code.code,
    'commission-gift-' || v_code.id::text
  );

  update public.commission_gift_codes
     set status = 'redeemed'
   where id = v_code.id;

  perform public.create_notification(
    p_user_id,
    'payout',
    'Gift code redeemed',
    'GHS ' || to_char(v_code.amount_minor / 100.0, 'FM999999990.00') ||
      ' has been added to your commission balance.',
    jsonb_build_object('commission_gift_code_id', v_code.id, 'amount_minor', v_code.amount_minor),
    'affiliate'
  );

  return jsonb_build_object(
    'outcome', 'ok',
    'amount_minor', v_code.amount_minor,
    'code', v_code.code
  );
end;
$$;

revoke execute on function public.redeem_commission_gift_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_commission_gift_code(uuid, text) to service_role;

/* An account flag and a support reply are about the ACCOUNT, so they belong in
   whichever bell the person is looking at. */
update public.notifications set business = 'both' where type in ('flag', 'support');

-- ---------------------------------------------------------------------------
-- A commission withdrawal changing hands is the affiliate bell's main event.
--
-- ⚠️ DONE WITH A TRIGGER, NOT BY EDITING `decide_commission_payout` AND
-- `mark_commission_payout_paid`. Those two move money. Reaching into a money
-- function to add a message is how a notification bug becomes a payment bug,
-- and a trigger on the status column catches every path into that column
-- including any written next year.
-- ---------------------------------------------------------------------------

create or replace function public.notify_commission_payout_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body  text;
  v_net   text := 'GHS ' || to_char(coalesce(new.net_minor, new.amount_minor) / 100.0, 'FM999999990.00');
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'approved' then
    v_title := 'Withdrawal approved';
    v_body  := 'Your commission withdrawal of ' || v_net || ' has been approved and is being sent.';
  elsif new.status = 'paid' then
    v_title := 'Withdrawal paid';
    v_body  := v_net || ' has been sent to your payout account.';
  elsif new.status = 'rejected' then
    /* The enum says `rejected`; the copy says "not approved", because the
       first is a database word and the second is what a person is owed. */
    v_title := 'Withdrawal not approved';
    v_body  := 'Your commission withdrawal was not approved. The amount is back in your balance.';
  else
    /* `cancelled` is the affiliate's own action. Telling somebody what they
       just did is noise. */
    return new;
  end if;

  perform public.create_notification(
    new.user_id, 'payout', v_title, v_body,
    jsonb_build_object('commission_payout_id', new.id),
    'affiliate'
  );
  return new;
end;
$$;

drop trigger if exists commission_payouts_notify on public.commission_payouts;
create trigger commission_payouts_notify
  after update of status on public.commission_payouts
  for each row execute function public.notify_commission_payout_status();

revoke execute on function public.notify_commission_payout_status() from public, anon, authenticated;
