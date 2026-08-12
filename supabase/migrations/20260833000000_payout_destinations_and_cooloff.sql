-- ============================================================================
-- Migration 185 — two payout destinations, and adding one is not changing one
--
-- Operator, 2026-08-12: the affiliate withdrawal "is asking me add payout
-- details on the manager account meanwhile i have added the two payout
-- details", and it has been doing so for days. Plus a rule: "a payout account
-- added is not a payout change so no cooloff should be applied, only changed
-- payout details need cooloff".
--
-- Three defects, and the one nobody had noticed is the worst.
--
-- ── 1. THE SCREEN SAID THERE WERE NONE BECAUSE THERE WERE TWO ──
--
-- `user_payout_details` is keyed `(user_id, method)`, so one person may hold a
-- mobile money row AND a crypto row. That is the design. But the affiliate
-- withdrawal page read them with `.maybeSingle()`, which ERRORS on two rows
-- and hands back null, and null means "no destination" to that screen. So
-- adding a second payout method removed the first one from the product. The
-- ads withdrawal reads the same table as an array and was never affected,
-- which is why this looked like an affiliate-only fault. Fixed in the page.
--
-- ── 2. THE PAYOUT FUNCTION PICKED ONE AT RANDOM ──
--
-- Worse, and invisible from the screen: `request_commission_payout` did
--
--     select * into v_details from public.user_payout_details
--      where user_id = p_user_id;
--
-- with no method and no ORDER BY. With two rows that is an ARBITRARY row, and
-- `select into` does not complain. Somebody holding both destinations could
-- have had their commission sent to the one they did not choose, and the
-- snapshot on the payout row would have looked entirely legitimate afterwards.
-- Phase 1's `request_redemption` has always taken `p_method` and filtered on
-- it; this is that function catching up.
--
-- The method is now required in all but one case: where the affiliate holds
-- exactly one destination it is still inferred, so nothing that works today
-- stops working. Where they hold two and the caller says nothing, it REFUSES
-- rather than guesses.
--
-- ── 3. ADDING A DESTINATION STARTED A 48-HOUR LOCK ──
--
-- `set_payout_details` stamped `last_changed_at = now()` on the insert as well
-- as the update, so somebody's first ever payout account locked them out of
-- withdrawing for two days. It also restamped on a re-save of identical
-- details, directly contradicting the comment three lines below it which says
-- re-saving the same details "should not restart the cool-off".
--
-- Fixed with a TRIGGER rather than by editing the function, deliberately. The
-- rule then holds for every writer — that function, an admin correction, a
-- screen written next year — instead of being a line each of them has to
-- remember. `last_changed_at` finally means what its name says: the last time
-- the destination CHANGED, and 'epoch' when it never has.
-- ============================================================================

create or replace function public.payout_details_stamp_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    /* The first time this person names this destination. Adding is not
       changing, so there is nothing to cool off from. 'epoch' rather than null
       because the column is NOT NULL and every reader compares it with
       `> now() - interval`, which 1970 can never satisfy. */
    new.last_changed_at := 'epoch';
    return new;
  end if;

  if coalesce(new.msisdn, '')          is distinct from coalesce(old.msisdn, '')
     or coalesce(new.account_name, '') is distinct from coalesce(old.account_name, '')
     or coalesce(new.wallet_address,'') is distinct from coalesce(old.wallet_address, '')
     or new.provider_id                is distinct from old.provider_id
     or new.coin_id                    is distinct from old.coin_id
     or new.network_id                 is distinct from old.network_id
  then
    new.last_changed_at := now();
  else
    /* Re-saving the same details is not a change. Carrying the old stamp
       forward is what stops a save button restarting somebody's lock. */
    new.last_changed_at := old.last_changed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists user_payout_details_stamp_change on public.user_payout_details;
create trigger user_payout_details_stamp_change
  before insert or update on public.user_payout_details
  for each row execute function public.payout_details_stamp_change();

/* Rows that were only ever added, never changed: `created_at = last_changed_at`
   is exactly that state, and every one of them has been carrying a cool-off it
   should never have had. */
update public.user_payout_details
   set last_changed_at = 'epoch'
 where last_changed_at = created_at;


-- ---------------------------------------------------------------------------
-- The payout function, told WHICH destination
-- ---------------------------------------------------------------------------
--
-- ⚠️ DROPPED AND RECREATED, because the signature grows. A defaulted third
-- parameter alongside the old two-argument version would make every existing
-- call ambiguous. Dropping re-grants EXECUTE to PUBLIC, so the grants are
-- restated at the bottom exactly as they were.

drop function if exists public.request_commission_payout(uuid, bigint);

create or replace function public.request_commission_payout(
  p_user_id uuid,
  p_amount_minor bigint,
  p_method public.payout_method default null
)
returns public.commission_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account  public.affiliate_accounts;
  v_details  public.user_payout_details;
  v_balance  bigint;
  v_minimum  bigint;
  v_fee_pct  numeric;
  v_fee      bigint;
  v_cooloff  int;
  v_ledger   uuid;
  v_quote    jsonb;
  v_provider text;
  v_coin     text;
  v_network  text;
  v_count    int;
  v_row      public.commission_payouts;
begin
  /* H45: off by default, and independent of the points switch, so one business
     can be opened without committing the other. */
  if not coalesce((select value::boolean from public.app_config
                    where key = 'affiliate_payouts_enabled'), false) then
    raise exception 'Commission withdrawals are not open yet'
      using errcode = 'check_violation';
  end if;

  select * into v_account from public.affiliate_accounts where user_id = p_user_id;
  if not found then
    raise exception 'You are not an affiliate' using errcode = 'check_violation';
  end if;
  if v_account.status = 'suspended' then
    raise exception 'This account is suspended' using errcode = 'check_violation';
  end if;

  /* WHICH DESTINATION. Named by the caller, or inferred only when there is
     exactly one to infer. Two rows and no method used to select an arbitrary
     one, silently. */
  select count(*) into v_count from public.user_payout_details where user_id = p_user_id;

  if v_count = 0 then
    raise exception 'Add where to send your money first' using errcode = 'check_violation';
  end if;

  if p_method is null then
    if v_count > 1 then
      raise exception 'Choose which account to send this to'
        using errcode = 'check_violation';
    end if;
    select * into v_details from public.user_payout_details where user_id = p_user_id;
  else
    select * into v_details from public.user_payout_details
     where user_id = p_user_id and method = p_method;
    if not found then
      raise exception 'Add your % details before requesting a payout',
        case p_method when 'crypto' then 'crypto wallet' else 'mobile money' end
        using errcode = 'check_violation';
    end if;
  end if;

  /* The same anti-takeover delay Phase 1 applies to points. Identical threat:
     take over an account, change the destination, withdraw before anybody
     notices. Adding a destination is not changing one, which is what the
     trigger above now guarantees. */
  v_cooloff := coalesce(public.config_int('payout_details_change_cooloff_hours'), 48);
  if v_details.last_changed_at > now() - make_interval(hours => v_cooloff) then
    raise exception 'Your payout details were changed recently. Try again in % hours.',
      v_cooloff using errcode = 'check_violation';
  end if;

  v_balance := public.affiliate_balance_minor(v_account.id);

  /* C21. A reversal after a payout can leave somebody owing, and the operator
     chose to block rather than write it off — so this refuses outright rather
     than quietly offering a smaller amount. */
  if v_balance <= 0 then
    raise exception 'You have nothing to withdraw' using errcode = 'check_violation';
  end if;

  v_minimum := coalesce(public.config_int('commission_payout_minimum_minor'), 0);
  if p_amount_minor < v_minimum then
    raise exception 'The least you can withdraw is %',
      to_char(v_minimum / 100.0, 'FM999999990.00') using errcode = 'check_violation';
  end if;

  if p_amount_minor > v_balance then
    raise exception 'You only have %',
      to_char(v_balance / 100.0, 'FM999999990.00') using errcode = 'check_violation';
  end if;

  -- ONE fee for the whole platform, shared with points (operator, 2026-08-06).
  v_fee_pct := coalesce(public.config_decimal('redemption_fee_percent'), 0);
  v_fee     := round(p_amount_minor * v_fee_pct / 100.0);

  if v_details.method = 'mobile_money' then
    select code into v_provider from public.payout_providers where id = v_details.provider_id;
  else
    select c.code, n.code into v_coin, v_network
      from public.payout_coins c
      left join public.payout_networks n on n.id = v_details.network_id
     where c.id = v_details.coin_id;

    /* Quoted and frozen. The coin price moves between asking and paying, and
       Phase 1's locked rule is that whoever asked for 12 USDT receives 12
       USDT — the cedi figure is what varies, not the coin. */
    v_quote := public.quote_crypto_payout((p_amount_minor - v_fee) / 100.0, v_coin);
  end if;

  insert into public.commission_payouts (
    affiliate_id, user_id, method,
    amount_minor, fee_percent, fee_minor, net_minor,
    snapshot_provider_code, snapshot_msisdn, snapshot_account_name,
    snapshot_coin_code, snapshot_network_code, snapshot_wallet,
    coin_amount, coin_usd, usd_ghs, quoted_at
  ) values (
    v_account.id, p_user_id, v_details.method,
    p_amount_minor, v_fee_pct, v_fee, p_amount_minor - v_fee,
    v_provider, v_details.msisdn, v_details.account_name,
    v_coin, v_network, v_details.wallet_address,
    nullif(v_quote ->> 'coin_amount', '')::numeric,
    nullif(v_quote ->> 'coin_usd', '')::numeric,
    nullif(v_quote ->> 'usd_ghs', '')::numeric,
    case when v_quote is not null then now() end
  )
  returning * into v_row;

  /* The money leaves the available balance NOW, not on approval. Three
     requests against one balance is otherwise reachable simply by tapping
     twice before an operator looks. */
  insert into public.commission_ledger
    (affiliate_id, entry_type, amount_minor, status, reason, idempotency_key)
  values (
    v_account.id, 'payout', -p_amount_minor, 'requested',
    'Withdrawal requested', 'payout:' || v_row.id::text
  )
  returning id into v_ledger;

  update public.commission_payouts set ledger_entry_id = v_ledger where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

/* ⚠️ Restated because the DROP above cleared them. Migrations 103 and 104
   exist because seventeen functions were answering the publishable key. */
revoke execute on function public.request_commission_payout(uuid, bigint, public.payout_method)
  from public, anon, authenticated;
grant execute on function public.request_commission_payout(uuid, bigint, public.payout_method)
  to service_role;
