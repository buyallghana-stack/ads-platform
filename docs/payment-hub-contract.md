# Payment hub: what the Tech Store side already does

Written 16 September 2026, at the end of the session that built Part A. This is
the handover for Part B, which is this repository's half.

Read the combined brief (`PAYMENT_HUB_combined.md`) for the reasoning. This file
is narrower and more useful: it is what the hub **actually does in production**,
verified against a real payment, so Part B can be built against facts rather
than intentions.

---

## The one thing that must not be broken

Nothing sent to Paystack may reveal SidePerks. Not the reference, not metadata,
not the callback, not the customer fields. The link between a payment and this
app lives only in the Tech Store's database.

This has been verified on a real transaction. Paystack holds a reference, an
amount, a currency and an email, and mentions `sideperks` nowhere.

**SidePerks holds no Paystack key and makes no Paystack call.** The key sitting
in this repo's `.env.local` and Vercel environment today is from the old
arrangement. Inventory what uses it and report before removing anything.

---

## Status: Part A is done and live

| Piece | State |
|---|---|
| Schema, RLS, grants | applied, `authenticated` cannot read a row |
| Request signing and replay protection | 19 unit tests |
| `initialize` and status endpoints | live, 18 checks passed |
| Webhook branch and atomic settle | live, store path unchanged and proven |
| Outbox, retry worker, `pg_cron` sweep | live, ladder verified on a real payment |
| `/pay/return` | live, five paths tested |
| Admin screen | live at `/admin/hub` |

A real GHS 1 payment has been taken through the whole chain. It settled, queued
a notification, and is now retrying against this app's confirm endpoint, which
does not exist yet. It answers 404 and the hub keeps trying, which is correct.

---

## The wire contract

Base URL: `https://techstoreghana.com`

### Signing, both directions

```
X-Hub-Timestamp    unix seconds
X-Hub-Request-Id   uuid v4, used once
X-Hub-Signature    hex HMAC-SHA256(secret, "<timestamp>.<request_id>.<raw body>")
```

- The window is **300 seconds**, absolute, so a clock running fast is refused as
  firmly as one running slow.
- A request id may be used **once**. The hub records it; replays are refused.
- Secrets are **comma separated lists**, newest first. Sign with the first,
  accept any of them. That is what makes rotation possible without downtime.
- A `GET` has no body, so it signs over the empty string. The timestamp and id
  are still covered, so it still cannot be replayed.
- The timestamp and the id are **inside** the signed material. Do not move them
  out; as headers alone either could be rewritten while keeping a valid
  signature, and a captured request would never go stale.

### The mirror, which is where this usually goes wrong

| Value | Tech Store calls it | This app calls it |
|---|---|---|
| `a88cad…` | `HUB_INBOUND_SECRETS` | `HUB_OUTBOUND_SECRETS` |
| `c47d21…` | `HUB_OUTBOUND_SECRETS` | `HUB_INBOUND_SECRETS` |

Same string, opposite name. **Both are already installed** in this project's
Vercel environment for production, preview and development, along with
`TECHSTORE_HUB_URL`. They are not in this repository and were never printed.

### `POST /api/internal/hub/payments/initialize`

Signed with this app's `HUB_OUTBOUND_SECRETS`.

```json
{
  "external_ref": "<payment_orders.id>",
  "amount_minor": 52000,
  "currency": "GHS",
  "customer_email": "ama@example.com",
  "return_url": "https://sideperks.org/payments/return"
}
```

Answers `200`:

```json
{ "reference": "TS-9F4C2A7B61E8", "authorization_url": "https://checkout.paystack.com/…", "reused": false }
```

- `amount_minor` is **integer pesewas**. 52000 is GHS 520.00. Never a float.
- `return_url` must be on the hub's allowlist, which is currently
  `https://sideperks.org` exactly. A lookalike such as
  `https://sideperks.org.attacker.com` is refused with `422`, tested.
- **Asking twice for the same `external_ref` returns the payment already
  running**, with `reused: true`. Do not create a second order for a retry.
- `401` unsigned, replayed, or stale. `400` malformed or invalid. `422` refused
  on business grounds. `500` the hub's fault, retry.

### `GET /api/internal/hub/payments/{reference}`

Signed the same way, empty body.

```json
{
  "reference": "TS-9F4C2A7B61E8",
  "external_ref": "7c2f8e10-…",
  "status": "initialized | success | failed | abandoned | reversed",
  "amount_minor": 52000,
  "currency": "GHS",
  "paid_at": "2026-09-16T01:42:11Z"
}
```

An intent still at `initialized` is re-verified with Paystack before answering,
behind a **ten second floor** per reference. A return page may poll, but polling
faster than that gets the cached answer. `404` for anything that is not a
SidePerks payment, including genuine Tech Store references.

### `POST` to this app: the confirm endpoint

The hub posts to `SIDEPERKS_CONFIRM_URL`, currently
`https://sideperks.org/api/internal/hub/confirm`, signed with the secret this
app stores as `HUB_INBOUND_SECRETS`.

```json
{
  "event": "payment.success | payment.failed | payment.reversed",
  "reference": "TS-9F4C2A7B61E8",
  "external_ref": "7c2f8e10-…",
  "amount_minor": 52000,
  "currency": "GHS",
  "paid_at": "2026-09-16T01:42:11Z"
}
```

- **Answer 2xx and the hub stops.** Anything else is a failure and it retries.
- Answer 2xx even for a mismatch you intend to ignore, then flag it for an
  admin. A non-2xx will be retried for 24 hours regardless.
- Retry ladder: 1 minute, 5, 30, 2 hours, 6, then hourly until 24 hours, after
  which it is marked given up and appears on the hub's admin screen with a
  manual retry button.
- The hub will never send the same event twice for the same payment. There is a
  unique constraint on `(payment_intent_id, event)` and a redelivery from
  Paystack queues nothing. **Make fulfilment idempotent anyway**, because the
  return page and the confirm endpoint race each other by design.

### `domain`: asked for on 17 September 2026, not yet sent

Paystack stamps `"domain": "live"` or `"domain": "test"` on every transaction
object it returns. The hub stores the whole object and neither app was reading
the field, which is how the store's Paystack account stayed in **test mode in
production** from the beginning without either side being able to see it. Six
SidePerks payments were reported successful over correctly signed requests and
granted plans. No money moved for any of them.

Nothing malfunctioned. The hub reported what Paystack told it and this app
believed the hub, and both were right to. What was missing was anyone asking
**which** Paystack.

So the request, on both payloads above:

```json
{ "domain": "live | test" }
```

- On the confirm POST, and on the `GET /payments/{reference}` answer.
- This app reads it already, at `src/lib/payments/hub/decide.ts`. It looks at
  the top level and at `data`, `paystack`, `paystack_payload` and
  `provider_payload`, so wherever it is forwarded it will be found.
- **Absence is not a refusal.** A payload with no `domain` reads as `unknown`
  and is fulfilled exactly as it is today. Making absence fatal would refuse
  every real payment in order to catch a case that cannot yet be seen, so the
  guard sits armed and idle until the field arrives.
- When it does arrive saying `test`, nothing is granted. The event is recorded,
  it is flagged on the admin payments screen as `test_mode`, and the hub is
  still answered 2xx, because it told the truth and retrying the truth for 24
  hours does not change it. The one exception is a deliberate rehearsal:
  `app_config.hub_accept_test_payments`, off by default.

---

## Decisions already taken that constrain Part B

Taken at gate H1 on 16 September, with the owner:

1. **Intents are SidePerks only.** Tech Store payments stay in the store's own
   tables. There is one source of truth per sale.
2. **A failed attempt may be retried under the same order.** The unique index
   covers only `initialized` and `success`, so once an intent is `failed` or
   `abandoned` a fresh one can be opened for the same `external_ref`. Keep the
   order, do not invent a new one.
3. **An unfinished payment is abandoned after 24 hours**, held in a setting on
   the hub rather than a constant.
4. **Reversal handling is undecided and is this repository's call.** The hub
   always marks the intent reversed and sends `payment.reversed`. Whether that
   revokes a plan or claws back a referral bonus is a question for the owner,
   and the brief says to ask before implementing it. It is the open item he is
   expecting to be brought back to him.

---

## Two things to check on day one

- **The existing Paystack code in this repo.** `PAYSTACK_SECRET_KEY` is present
  in `.env.local` and in Vercel for all three environments, and it belongs to a
  different Paystack integration than the hub's. Find what uses it, report, and
  ask before removing or disabling anything.
- **Uncommitted work.** As of this writing `src/lib/env.ts` and
  `src/middleware.ts` were modified and `src/lib/geo.ts` was untracked. Do not
  tangle new work with it.

---

## Access that exists

Supabase project `sideperks-production` (`mjivgeojeejaszcrkbbo`, eu-west-3,
renamed from `ads-dev` because a live database called "dev" is how somebody
eventually runs something destructive on it). Vercel project `ads-platform` in
team `buyallghana-stacks-projects`. GitHub `buyallghana-stack/ads-platform`.

Tokens for all three were issued during the Part A session and should be
rotated once Part B is finished.

---

## Round two, 16 September 2026: what the store changed and what we answered

The store replied to `docs/for-the-tech-store.md` with `for-sideperks.md`. Four
things in this file were affected. Read these before trusting the sections
above.

**`abandoned` is now reachable.** It had been in the status list since this
contract was written and the store had never once sent it, because nothing on
their side read their own `hub_intent_abandon_after_hours` setting. A sweep now
does. It asks Paystack about every intent still `initialized` past the window
before closing it, so `abandoned` means "we checked, the money was not taken",
which is a definite negative and not an unknown. This app maps it to the same
outcome as `failed` in `settleFromHub`, and records which of the two closed the
row in `provider_payload.hub_status`.

**Their window is 24 hours; ours is 48, on purpose.** Point 3 above was always
right and `docs/for-the-tech-store.md` was wrong to call our 48 "matching your
abandonment rule". Theirs is a setting their owner can change from a dashboard
without a deploy, so it is not a number to copy. Longer than theirs is the safe
direction: they close an attempt, with Paystack consulted, before we would
close it on our clock alone.

**Point 2 above describes their index, not our behaviour.** "Keep the order, do
not invent a new one" is what their unique index permits. This app does invent
one: `start_subscription_payment` inserts a fresh `subscription_payments` row on
every checkout, and `external_ref` is that row's id, so a buyer who abandons and
retries arrives as a NEW `external_ref` and never as a reused one. That is
deliberate, because the amount is chosen inside a band and a coupon may be
attached, so a second attempt is not always the same sale as the first. The
practical consequence is that `reused: true` is effectively unreachable from
here, and that their old stale-intent bug could never strand one of our buyers
on a dead link.

**There is no `payment.abandoned` event and we are not asking for one.** The
outbound enum stays at three members. The reconciliation sweep already polls,
which is the thing an event would have saved.

Two of their decisions, recorded so nobody reopens them:

- **The 422 wording stays** as "Could not reach the payment provider", even when
  Paystack refused the customer's email. Owner's decision, not an oversight.
  What protects the buyer is on our side and must not be removed:
  `hubInitialise` sets `refused` on a 422, the buyer is shown the `refused`
  copy, and the hub's own sentence is kept on the payment row and in the error
  report where it is useful rather than misleading.
- **Nothing is to be built for the referrer.** The 302 hop proposed in
  `docs/for-the-tech-store.md` would not have worked: a referrer is fixed when
  the browser begins the navigation and is carried across redirects unchanged,
  so a redirect can weaken it but never replace it. `Referrer-Policy:
  no-referrer` on the checkout route is the whole fix and it is already
  deployed.

Their admin screen for these payments is live at `techstoreghana.com/admin/hub`.
Look there before asking anyone to open a database.
