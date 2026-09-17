# For the Tech Store repo, round three: the guard is in, the capture is attached

Written 17 September 2026 from the SidePerks side, in reply to
`for-sideperks-2.md`. Nothing here reopens a settled item.

Section 1 answers what you asked us to check. Sections 2 and 3 are what you
asked us to send and to add.

---

## 1. The six grants: we are carrying one, and it is ours

Audited, and the answer is better than your letter assumed. Run
`scripts/audit-hub-test-money.mjs` in our repo to reproduce it; it is read only
at the server so it cannot revoke or refund anything by accident.

**Our whole payments table holds one row.**

| Status | Rows | Total |
|---|---|---|
| confirmed | 1 | GHS 85.00 |
| everything else | 0 | |

The one grant:

```
TS-109922FFA25B   GHS 85.00   Bronze
  confirmed     2026-09-17T00:33:44Z
  buyer         the SUPER ADMIN account, the owner's own
  activity      0 ads watched, 0 points, 0 withdrawal requests
  handed out    an active Bronze subscription running to 2026-11-06
  commission    none, every referral rate is still 0
```

So, in the terms your letter asks for: **internal, nothing to do, and nobody to
have a difficult conversation with.** No third party was paid a commission that
would have to come back. The owner will decide whether to revoke the
subscription; it is their own account and it changes nothing for anyone else.

**Where the other five went, which is ours to explain and not a fault of
yours.** We cleared this database on purpose before launch. Migration 227, `a
clean platform keeping its configuration`, truncates `subscription_payments`
and `hub_inbound_events` and deletes every account except the super admin. Any
payment from before it ran has no row here to find. That is why your six and
our one do not reconcile, and it is not a delivery failure: nothing was
refused, nothing was flagged, and we have no `unknown_reference` events at all.

**Reconciled against your own intents, so this is not a guess.** Your last
success, `TS-109922FFA25B`, `external_ref 60f3dabb-ede8-4e73-b372-9ede489fdbea`,
GHS 85.00 at 2026-09-17 00:33:17, is our one grant, confirmed here at 00:33:44.
Twenty-seven seconds apart, same reference, same figure. The other five point at
`external_ref`s this database no longer holds, all dated 16 September, and one
of them is `live-test-840ca8b8`, which is not a uuid at all and was somebody
typing.

Worth one line for your side: if your outbox ever re-drives those five, our
confirm endpoint answers `unknown_reference` and flags them. It grants nothing
and it will not retry, which is correct, and it is not silence.

While we were in there we also read what you have never had cause to: all six
of your successes carry `domain: test`, all four abandoned do too, and your six
failed rows carry no transaction object at all, so `domain` is null on them.
That last part matters for the change in section 3.

**And the question you could not answer from your side.** These are the exact
keys of every payload you have ever sent us, read back out of our own storage:

```
event, reference, external_ref, amount_minor, currency, paid_at
```

**`domain` is not among them.** So the reading described in section 3 is live
and idle, and nothing changes here until you add the field. Our one stored
success is printed in full by that script if you want to compare it against
what you believe you sent.

## 2. The capture you asked for: `docs/hub-signing-capture.json`

Attached, and it is a capture, not a transcription.

`tests/money/hub-wire-bytes.test.ts` stands a socket up on loopback, points
`requireHubConfig` at it, and runs the real `hubInitialise` and the real
`hubPaymentStatus` through it. What lands in the file is what came off the
wire. Run with `HUB_CAPTURE=1` it signs with the first entry of our live
`HUB_OUTBOUND_SECRETS`, which is your `HUB_INBOUND_SECRETS`, so the signature
verifies against the key you already hold. The key itself never leaves the
process.

In the file, per request: the method and path, the three headers, `raw_body`
byte for byte before any pretty printing, its length in bytes, and
`signing_material`, which is the exact string the HMAC was taken over. Both a
POST with a body and a GET with none, because an empty body signing as `""`
rather than as `"undefined"` is its own thing to get wrong. `secret_position` is
0, newest first.

**You were right about our test, and more right than you knew.** Our
`hub-signing.test.ts` had an assertion captioned "pinned deliberately" that
compared `hubSignature(...)` against `hubSignature(...)` with the same four
arguments. It pinned nothing. It is true of every function ever written.
Everything else in that file signs with our signer and verifies with our
verifier, so the whole file could pass over a signing string neither of us
agreed to.

That is now three literal hex digests, computed by hand from the contract. We
checked they bite: changing the separator in `hubSigningMaterial` from `.` to
`:` fails exactly those three tests and **twenty-two others still pass**, which
is the measure of what the file was worth before.

So we have made our half falsifiable. Send your equivalent whenever it suits and
we will commit it the same way. There is no deadline on this from our side
either.

## 3. `domain`: we read it, you do not send it

Added to the contract at `docs/payment-hub-contract.md`, under the confirm
payload, and implemented before the field exists, which is deliberate.

`src/lib/payments/hub/decide.ts` now reads `domain` out of anything you send.
Top level, or nested under `data`, `paystack`, `paystack_payload` or
`provider_payload`, so wherever it ends up we will find it. When it says `test`,
nothing is granted: the event is recorded, flagged on our admin payments screen
as `test_mode`, and you still get a 2xx, because you told the truth and
retrying the truth for 24 hours does not change it. There is one override,
`app_config.hub_accept_test_payments`, off by default and meant for the
rehearsal in your section 3.

**Absence stays permissive.** A payload with no `domain` reads as `unknown` and
is fulfilled exactly as it is today. Refusing what we cannot classify would
refuse every genuine payment in order to catch a case we cannot yet see, so the
guard sits armed and idle until the field arrives. The day you add it, nothing
needs writing here under time pressure with real money moving.

The ask, on the confirm POST and on the `GET /payments/{reference}` answer:

```json
{ "domain": "live | test" }
```

Section 1 already says it is not there today.

**And we have written it for you, but we are not asking you to take it yet.**
`docs/tech-store-forward-the-paystack-domain.sql` in our repo replaces
`hub_settle_intent`, and the note beside it has the TypeScript half for
`asStatus`. Our owner's call, 17 September: this ships WITH your live keys, not
before them. Landing it today would stop every plan purchase on our side until
the keys change, which is the guard working correctly and still the wrong week
for it.

Two things we found in your function while writing it, and both would have cost
you the change.

**`v_intent` is the snapshot from before the update.** The notification is
built from it after the update runs, so on a first settle
`v_intent.paystack_payload` is still null and the transaction object is in the
`p_payload` argument. `v_intent.paystack_payload ->> 'domain'` would therefore
forward `domain: null` on every real payment, and the whole exercise would look
finished while changing nothing. The line above it already handles this for
`paid_at` with `coalesce(v_intent.paid_at, v_now)`. Ours mirrors the update the
same way.

**The signature has to match to the argument, not to the intention.** The live
function is `(text, public.hub_intent_status, bigint, jsonb,
public.hub_outbound_event)`. Our first draft wrote `text` where the enums are
and put the arguments in a friendlier order, which `create or replace` would
have accepted as a SECOND overload beside the first, leaving the live one
untouched. We copied your header from `20260916072531` rather than retyping it,
and we suggest you do the same if you write your own.

## 4. Your warning about the amount check: ours was broken differently

Worth the ten minutes. Thank you.

Our expected side could not fail the way yours did.
`subscription_payments.amount_minor` is `bigint not null check (amount_minor >
0)`, so it can never be absent and two absences can never meet. We wrote the
test anyway, because "unreachable" is a claim about today's schema.

The stated side was worse than yours. The guard read:

```ts
const paid = Number(input.amountMinor ?? expected)
```

When the hub stated no amount, `paid` became `expected` and the check compared
the expectation against itself. Not a coerced zero meeting another coerced
zero: **a skipped check wearing the clothes of a passed one.** Every
`payment.success` with no `amount_minor` was granted with nothing compared, and
from outside, a skipped check and a passed check look identical.

It was reachable by two roads. Your confirm payload omitting the field, which
your contract says will not happen and which is exactly the assumption a guard
exists to not make. And our own `hubPaymentStatus`, which did
`Number(parsed.amount_minor ?? 0)` and turned "the hub said nothing" into "the
hub said zero cedis" before anything downstream could tell the difference. That
coercion is gone; absence now survives the journey and gets judged where the
judging happens.

Both readings are in `decide.ts`, pure and import free, the same move you made.
A positive whole number of minor units, or nothing, and nothing is never equal
to anything. `0`, `""`, `null`, `undefined`, `NaN`, a float, a negative, and
the ones `Number` lies about: `[]` and `false` become `0`, `true` becomes `1`,
`[52000]` becomes `52000`. All refused before any coercion runs. A success
stating no amount is now a flag for an admin, with its own sentence, because
"the hub reported GHS 0.00" would send somebody hunting for a zero payment that
never existed.

Your instinct about our exposure was right. Our amount is buyer-chosen inside a
price band and may carry a coupon, so we have more ways for two figures to
differ legitimately and more reason for the comparison to be exact.

## 5. What changed here, for your records

- `src/lib/payments/hub/decide.ts` is new: the amount reading, the currency
  reading, and the live-or-test reading, pure and import free.
- `src/lib/payments/hub/fulfil.ts` calls it. An unstated amount is a
  disagreement, and test money grants nothing.
- `src/lib/payments/hub/client.ts` stops coercing an absent amount to `0` and
  an absent currency to `GHS`, and carries `domain` through.
- `src/lib/payments/hub/resolve.ts` now writes a refusal down when the return
  page or the sweep is the one that reached it. It used to assume your POST had
  already flagged it, which is true only when your POST arrived. Until today, a
  refusal on that path left no row anywhere and the payment sat at `pending`,
  looking exactly like a checkout nobody finished. One row per reference per
  verdict, because that page polls.
- `tests/money/hub-amount-guard.test.ts`, `hub-fulfilment.test.ts` and
  `hub-wire-bytes.test.ts` are new. The middle one asserts only on whether
  `confirm_subscription_payment` was called, because a correct verdict returned
  into a branch nobody checks is not a guard.
- Migration 231 adds `hub_accept_test_payments`, off.

**The signing string, the 24 and 48 hour windows, the three members of
`hub_outbound_event` and the 422 wording are untouched.** Nothing here is a
contract change except the `domain` request, and that one is additive and
optional.

Understood about the rehearsal waiting for live keys, and we agree with the
reason. We will be ready when the note comes.
