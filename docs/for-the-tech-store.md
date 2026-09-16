# For the Tech Store repo: what SidePerks now does, and two things to fix

Written 16 September 2026 from the SidePerks side, after Part B was built,
deployed and put through a real payment. Hand this to whoever works in the
store repo next.

The contract itself is `docs/payment-hub-contract.md`, which the store wrote
and which is accurate. This file is the reply: what actually happens at the
other end now, what was verified, and the two things worth changing on your
side.

---

## Part B is live

`https://sideperks.org` is deployed and the whole chain works end to end. A
real GHS 85 card payment in Paystack test mode went from the upgrade screen,
through `initialize`, through Paystack, through your `/pay/return`, back to
`/payments/return`, and the plan was active before the page finished
rendering.

What SidePerks holds up:

- **`/api/internal/hub/confirm` exists and answers.** Unsigned gets 401.
- **Replay protection is real**, on a unique `request_id`. A repeat of the same
  request id answers `{"ok":true,"duplicate":true}` and touches nothing.
- **2xx means stop, and it is not the same as "it worked".** A mismatch, an
  unknown reference, and a payment we decline to act on all answer 2xx and are
  recorded. Only a fault on our side, something a later attempt could get
  past, answers non-2xx.
- **Fulfilment is idempotent.** The return page and your confirm POST race each
  other by design. On the real payment your webhook won and the return page
  found it already settled, spending no call on you.
- **Asking twice for one order is handled.** We send the same `external_ref`
  and use the `reused: true` answer rather than opening a second payment.
- **A reconciliation sweep runs every 15 minutes**, from `pg_cron` rather than
  Vercel (Hobby plan, two daily crons, both taken). It asks your status
  endpoint about anything still pending after 10 minutes and fails anything
  past 48 hours, matching your abandonment rule.
- **On `payment.reversed` we revoke the plan and claw back the referral
  commission.** That was the open decision in your handover; the owner settled
  it on 16 September. The revocation subtracts the period that payment bought
  rather than cancelling flat, so a reversal on a renewal does not confiscate
  weeks paid for earlier.

Verified against your live endpoints: a signed GET for an unknown reference
answers 404, an unsigned one answers 401. The mirrored secrets are installed
the right way round.

---

## Thing one: the 422 message is misleading, and it cost a real hour

**What happens.** When Paystack refuses the customer's email, your
`initialize` answers **422 with `{"error":"Could not reach the payment
provider"}`**.

**Why that is the wrong sentence.** Nothing was unreachable. Paystack answered,
and it said no. The message sends whoever reads it to look for a network fault
or an outage on your side, which is where I spent twenty minutes before
isolating it, and it is what SidePerks was passing through to the buyer until
we stopped doing that.

**How to reproduce.** Send `initialize` with a `customer_email` on a
non-routable domain, for example `someone@example.test`. It returns 422 with
that message in about two seconds. The same request with a real domain returns
200 and a checkout URL.

**What would help.** Distinguish "Paystack refused this request" from "we could
not reach Paystack", and say which field it objected to when Paystack tells
you. Something like:

```json
{ "error": "Paystack rejected the customer email", "field": "customer_email" }
```

A 422 already means "refused on business grounds" in your own contract, so the
status is right. It is only the wording that misleads.

**What SidePerks does in the meantime.** We no longer show your text to a
buyer. A 422 becomes "We could not start this payment. Check that the email
address on your profile looks right, then try again", and your real message is
kept on the payment row and in our error reporting. So this is not urgent for
us. It is worth fixing because the next person to debug it will be you.

---

## Thing two: Paystack was recording where the buyer came from

**This was our bug, and it is fixed on our side.** Telling you because it
concerns the one rule the whole arrangement exists to keep, and because there
is a better fix available only to you.

The hard rule is that nothing reaching Paystack may reveal SidePerks. Your
payload honours it completely: opaque reference, amount, currency, email, no
metadata. The browser did not. Clicking Pay is a cross-origin navigation, the
default referrer policy sends the origin, Paystack's checkout reads
`document.referrer`, and the transaction record ended up holding:

```
metadata: {"referrer":"https://sideperks.org/"}
```

Read back from Paystack's own API on `TS-E8B549558EB9`, a checkout started the
ordinary way. It lands when the page loads, so an abandoned checkout leaked it
just as well as a paid one.

We fixed it with `Referrer-Policy: no-referrer` scoped to the checkout route.
Verified after: the browser sends no `Referer`, and the record reads
`metadata: ""` with nothing anywhere mentioning sideperks.

**The better fix, which is yours.** A referrer policy can only remove, never
forge. Today `initialize` hands back Paystack's own `authorization_url` and we
send the buyer straight there. If instead it returned a URL on your domain,
something like `https://techstoreghana.com/pay/go/<reference>`, that 302s to
Paystack, then the buyer's last hop before Paystack would be the store, and
that is what Paystack would record.

That is better than empty. Instead of an absence, the record would
affirmatively say the traffic came from the merchant whose account it is,
which is exactly the story this arrangement is meant to tell. Perhaps fifteen
lines, and it changes nothing on our side: we already follow whatever
`authorization_url` you return.

---

## Things not to change without telling us

- **The signing scheme.** `HMAC-SHA256` over `"<timestamp>.<request_id>.<raw
  body>"`, 300 second window, request ids used once, secrets as comma
  separated lists newest first. Our implementation is pinned to this exact
  string by a test, deliberately, because a refactor that reorders the parts is
  a production outage rather than a style change.
- **`reused: true` on a repeated `external_ref`.** We rely on it to avoid
  opening a second payment when somebody reloads checkout.
- **The 404 for a reference that is not a SidePerks payment.** Our
  reconciliation reads it as a real answer, not as a failure to answer, and
  treats "not found" differently from "unreachable".
- **The return URL allowlist.** Ours is
  `https://sideperks.org/payments/return`. That route cannot move without your
  allowlist changing first.

## One thing we would like

An admin view on your side that lists **SidePerks** intents specifically, with
their status and their forward attempts. Your `/admin/hub` outbox covers
delivery. What is hard to answer from our side is "you say you sent it, we have
no record", and today that needs somebody with database access on both ends.

---

## How to check the hub is healthy from outside

Signed GET for a reference that cannot exist:

```
GET https://techstoreghana.com/api/internal/hub/payments/TS-SMOKE-000000000000
```

Signed should answer `404 {"error":"not found"}`; unsigned should answer 401.
That single pair proves the signature is accepted, the lookup runs, and the
door is shut to anyone without the secret.
