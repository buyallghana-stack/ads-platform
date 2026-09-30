-- ============================================================================
-- Crypto checkout through PayLink.
--
-- PayLink is the operator's own USDC-on-Base gateway. This app is one of its
-- merchants: it opens a payment there for a plan or a Vault deposit, sends the
-- buyer to PayLink's hosted checkout, and is told by a signed IPN when the
-- payment is finished. Prices are quoted in cedis; PayLink converts to USDC at
-- a rate it locks for the payment window.
--
-- Nothing here grants anything on its own. A PayLink `finished` ends in the
-- same `confirm_subscription_payment` / `confirm_vault_payment` every other
-- rail ends in, so the plan, the referral bonus and the Vault investment are
-- decided in one place whichever way the money came.
--
-- WHAT A ROW LOOKS LIKE
-- A crypto payment is an ordinary payment row with method `crypto`, whose
-- `external_reference` is PayLink's `payment_id`. PayLink is told the row's
-- own id as `order_id`, so every IPN names the exact row it is about.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Every IPN PayLink sent us, and what we did about it.
--
-- ⚠️ THIS IS NOT THE HUB'S TABLE, AND THE DIFFERENCE IS THE POINT.
-- The hub signs every retry as a new request with a new id, so recording the
-- id first and refusing a repeat is safe there. PayLink retries (and an admin
-- resend) carry the SAME `event_id`. If the id were burned before the work was
-- done, an event that failed on our side would be skipped as a duplicate on
-- every retry and the payment would never be applied. So a repeat is only a
-- duplicate when the first attempt reached a final `result`; see the IPN route.
-- ----------------------------------------------------------------------------
create table if not exists public.paylink_events (
  event_id     text primary key,
  type         text        not null,
  livemode     boolean     not null,
  -- PayLink's payment_id or payout_id.
  object_id    text,
  -- Our row: a subscription_payments / vault_payments id, or a redemption id.
  row_id       uuid,
  row_kind     text        check (row_kind in ('subscription', 'vault', 'redemption')),
  status       text,
  payload      jsonb       not null default '{}'::jsonb,
  -- received → applied | already_done | ignored | unknown_order | mismatch
  --          | mode_mismatch | error
  result       text        not null default 'received',
  detail       text,
  deliveries   integer     not null default 1,
  received_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.paylink_events is
  'Signed IPNs from PayLink, one row per event_id. A repeat is re-processed unless the first attempt reached a final result, because PayLink retries reuse the event_id.';

create index if not exists paylink_events_row_idx
  on public.paylink_events (row_id, received_at desc);
create index if not exists paylink_events_attention_idx
  on public.paylink_events (result, received_at desc)
  where result not in ('applied', 'already_done', 'ignored');

-- Service role only. There is no policy, so a browser token reads nothing.
alter table public.paylink_events enable row level security;


-- ----------------------------------------------------------------------------
-- 2. The switches.
-- ----------------------------------------------------------------------------
insert into public.app_config (key, value, value_type, description, is_public) values
  -- OFF on purpose, like every rail before it: a switch that ships on is a
  -- switch nobody remembers deciding.
  ('paylink_checkout_enabled', 'false', 'bool',
   'Whether buyers are offered paying for a plan or a Vault deposit with USDC through PayLink. Off hides the option and refuses new crypto checkouts; payments already open still settle.',
   false),

  -- The Paystack incident, learned once: a test key in production granted
  -- plans against no money. A PayLink event from test mode (Base Sepolia,
  -- faucet USDC) is refused in production unless this is on.
  ('paylink_accept_test_payments', 'false', 'bool',
   'Whether a PayLink TEST mode payment (testnet USDC, no real money) may grant a plan or Vault deposit in production. Only for a rehearsal. On means free plans for anyone holding testnet USDC.',
   false)
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- 3. The PayLink reference for a Vault deposit.
--
-- Plans already have `attach_hub_reference`, whose rule is exactly what is
-- wanted here (set once, re-attaching the same value is a no-op, anything
-- else is a conflict), and `attach_vault_hub_reference` is its twin. Both are
-- reused for PayLink's payment_id rather than copied: the rule is about the
-- column, not about who issued the reference.
--
-- What IS new is the method. `start_vault_payment` does not take one and
-- defaults the row to `paystack`, and the reconciliation sweep has to be able
-- to tell a PayLink deposit from a hub one, or it will ask the hub about a
-- reference the hub never issued and close a paid deposit after 48 hours.
-- ----------------------------------------------------------------------------
create or replace function public.mark_vault_payment_crypto(p_payment_id uuid)
returns public.vault_payments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pay public.vault_payments;
begin
  select * into v_pay from public.vault_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'check_violation';
  end if;
  if v_pay.status <> 'pending' or v_pay.external_reference is not null then
    raise exception 'Only a fresh pending deposit can be switched to crypto'
      using errcode = 'check_violation';
  end if;

  update public.vault_payments set method = 'crypto'
   where id = p_payment_id
  returning * into v_pay;
  return v_pay;
end;
$function$;

revoke execute on function public.mark_vault_payment_crypto(uuid) from public, anon, authenticated;
grant  execute on function public.mark_vault_payment_crypto(uuid) to service_role;
