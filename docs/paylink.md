# PayLink: crypto checkout and automatic crypto payouts

PayLink is the operator's own USDC-on-Base gateway. This app is one of its
merchants. PayLink's merchant guide lives in the gateway repository at
`docs/merchant-integration.md`.

## Configuration

Server-only environment variables, never `NEXT_PUBLIC_`:

| Variable | Value |
|---|---|
| `PAYLINK_API_URL` | `https://crypto-gateway-beta.vercel.app/api/v1` |
| `PAYLINK_API_KEY` | `gw_test_…` on Preview, `gw_live_…` on Production. The prefix is the mode. |
| `PAYLINK_IPN_SECRETS` | The IPN secret for that mode. Comma separated, newest first, to rotate. |

Set them with `vercel env add` (mark them sensitive). The PayLink admin sets
this app's IPN URL to `https://sideperks.org/api/payments/paylink/ipn`.

Switches in the admin (Platform settings), all shipped off:

- `paylink_checkout_enabled`: offer USDC at the plan and Vault checkouts.
- `auto_payout_enabled`: pay USDC-on-Base withdrawals without an admin when
  every rule passes. The rules sit in the same group.
- `paylink_accept_test_payments`: let testnet USDC grant plans in production.
  Rehearsals only.
- The **USDC · Base** payout network ships inactive; activate it under the
  payout coins when PayLink is live.

Nothing is ever sent unless **both** `PAYOUTS_ENABLED` (environment) and
`payouts_enabled` (database) are on.

## Paying (plans and Vault deposits)

1. `start_subscription_payment` (method `crypto`) or `start_vault_payment`
   prices the row, as for every rail.
2. `POST /payments` with `price_currency: GHS`, `order_id` = our row id,
   `customer_ref` = our user id, idempotency key `payment-<row id>`.
3. PayLink's `payment_id` is stored as the row's `external_reference`, then the
   buyer is sent to `checkout_url` (only if it is on PayLink's own origin).
4. The plan or deposit is granted by `confirm_*_payment` when PayLink says
   `finished`: from the IPN, the return page (`/payments/return?paylink=<row
   id>`, which asks PayLink itself), or the 15-minute reconciliation sweep.

Before granting: the row must be a crypto row carrying that `payment_id`;
`livemode` must match the key; and `price_amount`/`price_currency` must equal
what the row asked for. Anything else grants nothing and is flagged.

## Withdrawals

USDC on Base only. Mobile money and other coins or networks are unchanged.

1. The points leave the balance when the member asks (`request_redemption`).
2. Every 5 minutes, `/api/cron/paylink-payouts` (rung by pg_cron) releases
   elapsed holds, then runs `auto_approve_redemption` on each new withdrawal.
   It is approved when every rule passes; otherwise it waits for an admin, and
   the failing rules show in the payouts drawer. The decision is made once.
3. Approved withdrawals (by the system or an admin) are claimed with
   `claim_paylink_payout`, then sent with `POST /payouts` in **GHS**:
   `net_amount`, i.e. after the withdrawal fee. PayLink converts at its own
   rate. `payout_ref` and the idempotency key are the withdrawal id.
4. `apply_paylink_payout` records PayLink's answer. `completed` marks it paid
   (the tx hash is the reference). `rejected` or `failed` refunds the points.
   While PayLink is settling a payout, an admin cannot decline it or mark it
   paid by hand.

PayLink has its own rules and may hold a payout for its admin
(`held_for_review`). Its defaults hold every first payout and every new
address, so loosen them in PayLink's merchant settings if SidePerks' rules are
meant to be the ones deciding.

## IPNs

`POST /api/payments/paylink/ipn`. The `x-gateway-signature` is verified
against the raw body (5 minutes of clock tolerance), failures get 401.
Events are kept in `paylink_events` by `event_id`. PayLink retries with the
same `event_id`, so a repeat is only skipped once the first attempt reached a
final result. One that errored on our side is processed again.
