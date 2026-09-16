# Payment Hub — Combined Claude Code Brief (Tech Store + SidePerks)

This document covers **both** codebases:
- **Part A:** Tech Store (the payment hub, which owns the Paystack account)
- **Part B:** SidePerks (the hub client, which never calls Paystack)

The same file goes into both repos. In the Tech Store repo, implement Part A; in the SidePerks repo, implement Part B. Read **both** parts either way, because the signed API contract between them must match exactly. **Build order:** Part A first, then Part B, then the joint end-to-end tests.

---

## STEP 0 — Access & Tooling Preflight (MANDATORY, before any code)

Do not write code, run migrations, or change configuration until this step is complete and the owner has confirmed it.

### 0.1 Inventory what you have
Check and report what is actually connected and working right now, not what you assume:
- MCP servers available in this session (list them by name).
- CLIs installed and authenticated (e.g. `supabase`, `vercel`, `gh`/`git`, `node`/`pnpm`/`npm`).
- Env files present, identified **by variable name only**. Never print secret values.

### 0.2 Required access for this work
Confirm each item below. Mark it ✅ available, ❌ missing, or ⚠️ partial/unclear.

**Supabase**
- [ ] Supabase MCP (or authenticated Supabase CLI) with access to **Project A (Tech Store)**
- [ ] The same for **Project B (SidePerks)**. The projects may be in different orgs; confirm you can reach both.
- [ ] Permission to create and apply migrations, create tables and RLS policies, and read logs on both
- [ ] Ability to set up scheduled jobs (pg_cron / Supabase cron), if that option is chosen

**Vercel (or the actual host; confirm with the owner)**
- [ ] Vercel MCP, or an authenticated Vercel CLI/token, for the **Tech Store** project
- [ ] The same for the **SidePerks** project
- [ ] Permission to set environment variables (Preview + Production), configure Cron Jobs, view deployments and logs

**Source control**
- [ ] Read/write access to **both** repositories (GitHub or wherever they are hosted)
- [ ] Knowledge of the branch strategy: which branch deploys to production and which to preview

**Paystack (Tech Store only)**
- [ ] Test secret key available as an env var in the Tech Store project
- [ ] Live secret key: **not needed until gate H4 is approved**; confirm only where it will be stored
- [ ] Someone who can set the webhook URL in the Paystack dashboard. This is usually the owner; give them the exact URL to paste in.
- [ ] Confirmation of which webhook events are enabled

**Domains & networking**
- [ ] Production and preview URLs for both apps (needed for the return-URL allowlist and the confirm URL)
- [ ] Any firewall, bot protection, or middleware (e.g. Cloudflare, Turnstile, auth middleware) that could block server-to-server calls to `/api/internal/*` and `/api/webhooks/paystack`

**Secrets to be generated**
- [ ] `HUB_INBOUND_SECRET` and `HUB_OUTBOUND_SECRET` (strong random values). Plan how they get into **both** Vercel projects without being pasted into chat or committed.

**Alerts (optional but recommended)**
- [ ] A channel for failed-forward and mismatch alerts (email service, Slack/Telegram webhook, or admin panel only)

**Anything else**
- [ ] List any other MCP, service, API token, or permission you discover you need while reading the codebase.

### 0.3 Report and stop
Give the owner a short report with:
1. ✅ What you have
2. ❌ What is missing, and for each item **exactly** how the owner can grant it (which MCP to connect, which token to create and with what scope, where to add it)
3. ⚠️ Questions you need answered

**Then stop and wait.** Proceed only when every ❌ is resolved or the owner explicitly says to proceed without it.

### 0.4 Secret-handling rules (apply throughout)
- Never ask the owner to paste secret keys into chat. Direct them to add secrets to Vercel env vars, `.env.local`, or the Supabase dashboard.
- Never print, log, or commit secret values. `.env*` files must be in `.gitignore`.
- Request tokens with the **minimum scope** needed, and tell the owner which scope to choose.

---

# PART A — TECH STORE (PAYMENT HUB)


### Context
The owner runs two separate products on **one** Paystack account (one corporate bank account):

- **Tech Store** (this repo): Next.js + Supabase (project A). Owns the Paystack account.
- **SidePerks**: Next.js + Supabase (project B). A separate app with a separate database.

**Business decision (final, from Paystack's guidance):** every request sent to Paystack's API identifies as the Tech Store. SidePerks never talks to Paystack. The Tech Store acts as the **payment hub**. It creates transactions for both apps, receives all Paystack webhooks, and forwards SidePerks confirmations to SidePerks server-to-server.

**Hard rule:** nothing sent to Paystack may reveal SidePerks. That covers metadata, references, callback URLs, customer fields, descriptions, and split/subaccount data. The link between a payment and SidePerks lives only in the Tech Store database.

## Operating contract
- Behave as a senior engineer. Read the existing checkout, Paystack, and webhook code before changing anything.
- Ask, don't guess. When something is ambiguous, stop and ask the owner.
- Warn before doing anything that could break existing Tech Store checkout, orders, or live payments.
- The existing Tech Store checkout must keep working identically. Treat this work as additive.

### Approval gates (stop and get owner approval)
- **H1:** Schema migration plan (tables, RLS, indexes) before applying it.
- **H2:** Any change to the existing Tech Store webhook handler or checkout flow.
- **H3:** Secret and environment variable plan before implementing request signing.
- **H4:** The end-to-end test plan in Paystack **test mode**, before any live keys are used.

## 1. Data model (Supabase project A)
All new tables are server-only. Enable RLS with **no** anon or authenticated policies; access them only through the service role on the server.

**`payment_intents`**: one row per Paystack transaction, for both apps.
- `id` (uuid), `reference` (text, unique, opaque, e.g. `TS-<random>`; must not encode the source app)
- `source_app` (enum: `techstore`, `sideperks`)
- `external_ref` (text, nullable; the SidePerks order id)
- `amount_minor` (integer, pesewas), `currency` (`GHS`)
- `customer_email`
- `return_url` (where the user goes after paying; internal only, never sent to Paystack)
- `status` (`initialized`, `success`, `failed`, `abandoned`, `reversed`)
- `paystack_payload` (jsonb, the verified transaction), `paid_at`, `created_at`, `updated_at`
- Unique constraint on (`source_app`, `external_ref`) where not null, so one SidePerks order cannot create two live intents. Propose how retries of a failed attempt should work (H1).

**`webhook_events`**: idempotency and audit log of Paystack webhooks.
- `id`, `event_type`, `reference`, `raw_body_hash` (unique), `received_at`, `processed_at`, `result`

**`outbound_notifications`**: outbox for forwarding to SidePerks.
- `id`, `payment_intent_id`, `event` (`payment.success`, `payment.failed`, `payment.reversed`), `payload` (jsonb), `attempts`, `next_attempt_at`, `last_error`, `delivered_at`

**`hub_request_ids`**: replay protection for signed inbound requests (id plus timestamp; purge entries older than 1 day).

## 2. Internal hub API (called by the SidePerks server only)
All endpoints use signed requests (section 4). They are never called from a browser.

### `POST /api/internal/hub/payments/initialize`
Body: `{ external_ref, amount_minor, currency, customer_email, return_url }`
1. Verify the signature, timestamp, and request id.
2. Validate the input: integer amount > 0, currency `GHS`, valid email. `return_url` must match an **allowlist** in env (SidePerks domains only).
3. Create a `payment_intents` row with `source_app = sideperks`.
4. Call Paystack `POST /transaction/initialize` with:
   - `email`, `amount`, `currency`, `reference`
   - `callback_url` = the **Tech Store** return route (section 3), never a SidePerks URL
   - no SidePerks-identifying metadata (a neutral `intent_id` is fine)
5. Return `{ reference, authorization_url }`.

If an initialized intent already exists for the same `external_ref`, return it rather than creating a duplicate.

### `GET /api/internal/hub/payments/:reference`
Returns `{ reference, external_ref, status, amount_minor, currency, paid_at }` for SidePerks intents only. SidePerks uses this for its return page and for reconciliation. Before answering, if the status is still `initialized`, re-verify with Paystack `GET /transaction/verify/:reference`.

## 3. Return route: `GET /pay/return?reference=...`
Paystack redirects the customer here. Look up the intent.
- For `techstore` intents, keep the existing behaviour.
- For `sideperks` intents, redirect (302) to the stored `return_url` with `?reference=`.

This page does **not** mark anything paid. Only the webhook or verify does that.

## 4. Request signing (both directions)
- Headers: `X-Hub-Timestamp` (unix seconds), `X-Hub-Request-Id` (uuid), `X-Hub-Signature`.
- Signature: hex `HMAC-SHA256(secret, "<timestamp>.<request_id>.<raw body>")`.
- Reject a request if the timestamp is more than 300 seconds off, the request id has already been seen, or the signature doesn't match. Use a constant-time comparison.
- Use **separate secrets per direction**: `HUB_INBOUND_SECRET` (SidePerks → hub) and `HUB_OUTBOUND_SECRET` (hub → SidePerks).
- Support two active secrets per direction so keys can be rotated without downtime.
- Put the signing and verification code in one small module with unit tests.

## 5. Paystack webhook: `POST /api/webhooks/paystack`
Extend the existing handler if one exists (H2).
1. Read the **raw body**. Verify `x-paystack-signature` = HMAC-SHA512 of the raw body using the Paystack secret key. Reject if it doesn't match.
2. Deduplicate by raw body hash in `webhook_events`.
3. For charge events, confirm with Paystack `GET /transaction/verify/:reference`. Check that status, amount, and currency match the intent. On a mismatch, flag it, alert the admin, and do not fulfil.
4. Update `payment_intents.status`, updating each row only once.
5. Branch on the intent's app:
   - `techstore`: run the existing order logic.
   - `sideperks`: insert an `outbound_notifications` row **in the same transaction** as the status update.
6. Return 200 quickly. Do the forwarding outside the webhook request.

Also handle refund, reversal, and dispute events. Mark the intent `reversed` and queue a `payment.reversed` notification for SidePerks intents. Ask the owner which Paystack event types are enabled on the account.

## 6. Forwarding worker
- Run it on a scheduled job (propose Vercel Cron or Supabase cron at H1), plus an immediate attempt right after the webhook.
- Signed `POST` to `SIDEPERKS_CONFIRM_URL` with `{ event, reference, external_ref, amount_minor, currency, paid_at }`.
- A notification is delivered only when SidePerks returns a 2xx.
- Otherwise retry with exponential backoff (e.g. 1m, 5m, 30m, 2h, 6h, then hourly up to 24h). After that, mark it failed and show it in the admin panel.

## 7. Admin (Tech Store dashboard)
- Filter payments by `source_app`, with totals per app and per date range, and CSV export for bookkeeping.
- An outbox view showing pending and failed notifications, with a manual "retry now" action.
- A mismatch/alert list.
- SidePerks payments are **not** Tech Store orders. They must not appear in order management, inventory, delivery, or dispute flows.

## 8. Environment variables
`PAYSTACK_SECRET_KEY`, `HUB_INBOUND_SECRET(S)`, `HUB_OUTBOUND_SECRET(S)`, `SIDEPERKS_CONFIRM_URL`, `SIDEPERKS_RETURN_URL_ALLOWLIST`, `APP_BASE_URL`. All are server-only; never prefix them with `NEXT_PUBLIC_`.

## 9. Tests (test mode, H4)
- A Tech Store purchase still works unchanged.
- A SidePerks purchase goes from initialize, through payment and the return redirect, to the webhook and forward; SidePerks confirms.
- A duplicate webhook produces one update and one notification.
- With SidePerks down, the notification retries, then delivers once SidePerks is back.
- A tampered signature, stale timestamp, or replayed request id is rejected.
- An amount mismatch is flagged and not fulfilled.
- The Paystack payload is inspected to confirm nothing references SidePerks.

## Open items for the owner
- Written confirmation from Paystack that this setup is approved for the verified account.
- Which Paystack webhook events are enabled.
- The SidePerks production domain(s) for the allowlist.

---

# PART B — SIDEPERKS (HUB CLIENT)


### Context
SidePerks (this repo) and the Tech Store are separate Next.js apps on **separate Supabase projects**. They share **one** Paystack account, which is owned by and registered to the Tech Store.

**Business decision (final):** SidePerks never calls Paystack and holds no Paystack keys. SidePerks payments (plan purchases, affiliate training, digital products) are created through the **Tech Store payment hub** over a signed server-to-server API. The hub receives Paystack's webhooks and forwards confirmations to SidePerks.

**Out of scope:** user payouts (Korapay, mobile money, crypto gateway) do not change and must not route through this hub.

## Operating contract
- Behave as a senior engineer. Read the existing checkout, plan, and payment code first.
- Ask, don't guess. Warn before anything that could break existing flows.
- There may be existing Korapay/crypto code for **incoming** subscription payments. Report what exists and **ask** before removing, disabling, or keeping it alongside the hub.

### Approval gates
- **S1:** Schema migration plan.
- **S2:** Any change to existing plan activation, subscription expiry, or referral/commission logic.
- **S3:** Secrets and environment variable plan.
- **S4:** End-to-end test plan in Paystack test mode, together with the Tech Store.

## 1. Data model (Supabase project B)
Server-only tables with RLS. Users may read only their own orders, and only through a safe view.

**`payment_orders`**
- `id` (uuid, sent to the hub as `external_ref`), `user_id`
- `purpose` (`plan`, `affiliate_training`, `product`, …), `purpose_ref` (the plan, course, or product id)
- `amount_minor` (integer pesewas, **computed server-side from current admin config**, never from the client), `currency` (`GHS`)
- `hub_reference` (unique, nullable), `status` (`pending`, `paid`, `failed`, `reversed`)
- `fulfilled_at`, `created_at`, `updated_at`

**`hub_inbound_events`**: idempotency and audit log. Stores the request id, event, reference, received time, and result.

## 2. Checkout flow
1. The user chooses a plan or product. The client sends only the item id.
2. The server looks up the price from admin config and creates a `pending` `payment_orders` row.
3. The server makes a signed `POST {TECHSTORE_HUB_URL}/api/internal/hub/payments/initialize` with `{ external_ref, amount_minor, currency, customer_email, return_url }`. `return_url` is `https://<sideperks>/payments/return`.
4. Store `hub_reference` and redirect the user to `authorization_url`.
5. If the user retries a pending order, reuse the same order. Don't create duplicates.

**Checkout UI note (required):** next to the pay button, state clearly that payments are securely processed by the Tech Store and will show under its name on Paystack checkout and bank statements. Put the name in an admin setting or i18n key, not hardcoded. Follow the project rule: ask the owner for mobile, tablet, and desktop design references before building UI.

## 3. Return page: `/payments/return?reference=...`
- Never trust the redirect alone.
- If the order is already `paid`, show success.
- If it's still `pending`, call the signed hub status endpoint `GET /api/internal/hub/payments/:reference`. If that reports success, run the **same** fulfilment function the confirm endpoint uses. Otherwise show a "confirming your payment" state that polls briefly.

## 4. Confirm endpoint: `POST /api/internal/hub/confirm`
Called only by the Tech Store hub.
1. Verify the signature, timestamp (±300s), and request id, using the same scheme as the hub: hex `HMAC-SHA256(secret, "<timestamp>.<request_id>.<raw body>")` with headers `X-Hub-Timestamp`, `X-Hub-Request-Id`, and `X-Hub-Signature`. Reject replays.
2. Find the order by `external_ref` and `reference`. If `amount_minor` or `currency` doesn't match, don't fulfil; flag it for admin and return 2xx so the hub stops retrying.
3. Handle each event:
   - `payment.success`: mark `paid` and run fulfilment. Fulfilment is **idempotent**; a second call does nothing.
   - `payment.failed`: mark `failed`.
   - `payment.reversed`: mark `reversed` and ask the owner what should happen (revoke the plan? claw back referral bonuses?) before implementing it.
4. Return 2xx only after the database commit.

**Fulfilment** is one shared function used by the confirm endpoint, the return page, and reconciliation. It activates or extends the plan, unlocks training or products, and triggers referral or commission logic exactly once, reusing the existing logic (S2).

## 5. Reconciliation job
Run it on a schedule, every 15 minutes. For orders still `pending` after 10 minutes and less than 48 hours old, query the hub status endpoint and fulfil or fail them accordingly. Mark orders older than 48 hours as `failed` (abandoned).

## 6. Admin (SidePerks dashboard)
- A payments list with status, purpose, and user, plus revenue totals and CSV export.
- A flagged-mismatch list and a manual "re-check with hub" action.
- Every admin action is written to the existing audit log.

## 7. Environment variables
`TECHSTORE_HUB_URL`, `HUB_OUTBOUND_SECRET(S)` (SidePerks → hub; this matches the hub's inbound secret), `HUB_INBOUND_SECRET(S)` (hub → SidePerks), and `APP_BASE_URL`. All are server-only. **No Paystack keys** belong in this repo.

## 8. Tests (with the Tech Store, S4)
- A plan purchase runs end to end in test mode, and the plan activates once.
- The webhook forward and the return page race each other; fulfilment still runs once.
- With the hub unreachable at the return page, reconciliation completes the order later.
- A forged or replayed confirm request is rejected.
- A client-tampered price has no effect, because the server recomputes it.
- A reversal event is handled per the owner's decision.
- Existing Korapay/crypto payout flows are untouched.

## Open items for the owner
- What happens to plans and referral bonuses on refund or reversal.
- What to do with any existing incoming-payment Korapay/crypto code.
- The exact business name to show in the checkout note.
