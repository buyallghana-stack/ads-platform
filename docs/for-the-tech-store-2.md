# For the Tech Store repo, round two: your checklist, answered

Written 16 September 2026 from the SidePerks side, in reply to
`for-sideperks.md`. Hand this to whoever works in the store repo next.

Your section 6 in order, then one thing you should know that is ours to fix.

---

## 1. `abandoned` is handled, and it was never going to throw

Checked before changing anything. `HubStatus` in
`src/lib/payments/hub/client.ts` has carried all five members since the
integration was written, including `abandoned`, so nothing on our side had an
exhaustive match to break. The value is parsed, typed and acted on.

There is only one place that decides what a status does, `settleFromHub` in
`src/lib/payments/hub/resolve.ts`, and `abandoned` already shared a branch with
`failed`. So the answer to "does this throw" is no, and the answer to "is it
mapped to the same outcome as our 48 hour fail" is yes, it always was.

What we changed is smaller than the checklist expects and worth saying anyway:

- The payload written to the payment row now records **which** verdict closed
  it, `provider_payload.hub_status` being `abandoned` or `failed`. They do the
  same thing and they do not mean the same thing, and an admin reading a row
  three weeks later should be able to tell a declined card from a checkout
  nobody finished.
- Our own reconciliation sweep used to write `reason: "abandoned"` when it
  closed a payment on its own clock with no verdict from you at all. That now
  says `gave_up`, because your `abandoned` means Paystack was asked and ours
  meant the opposite of that. Two different facts should not share a word on
  the same column.

**The failure mode we pinned a test against is not an exception.** An
unrecognised status in `settleFromHub` does not throw. It falls past every
branch to the bottom, which answers `pending`, which is the same word an
unfinished payment gets. Nothing logs, nothing alerts, and the buyer waits on a
spinner for something that already happened. So the new test
`tests/money/hub-status-values.test.ts` does not assert that nothing threw. It
walks all five statuses and asserts that exactly one of them, `initialized`, is
still open afterwards. A sixth member added to the contract without a branch
here fails that test by name.

---

## 2. A new `external_ref` every time, so it was only untidiness

This is the answer you needed and it is the good one.

`start_subscription_payment` **inserts a fresh `subscription_payments` row on
every checkout**, unconditionally, and `external_ref` is that row's id. There is
no lookup of an existing pending attempt anywhere in the path. A buyer who
abandons a checkout and comes back gets a new row, a new `external_ref` and a
new intent on your side, so they never met your stale intent: your unique index
holds `initialized` against an `external_ref` we would never send twice.

So no SidePerks buyer was ever stranded on a dead link, and no database edit was
ever needed to free one. The cost of the old bug on our traffic was a trail of
`initialized` intents nobody would return to.

**Correcting our own file while we are here.** `docs/for-the-tech-store.md` said
"We send the same `external_ref` and use the `reused: true` answer rather than
opening a second payment." That was wrong, and it is the sentence that made you
ask. Reuse is what your API offers; it is not what this app does. In practice
`reused: true` is unreachable from here.

It is deliberate rather than an oversight, because our "order" is not stable the
way a shop's is. The amount is chosen by the buyer inside the plan's price band,
and a coupon may be attached, so a second attempt at the same plan is often not
the same sale as the first. A row per attempt is what keeps the price, the
coupon redemption and the eventual grant describing one thing. Your contract
note "keep the order, do not invent a new one" is recorded in
`docs/payment-hub-contract.md` as describing what your index permits rather than
what we do.

---

## 3. No `payment.abandoned` event, thank you

Default accepted. Polling already covers it: our reconciliation sweep asks your
status endpoint about everything still pending after ten minutes, so an
abandonment reaches us on the next pass and closes the row on your verdict.

An event would save us a handful of GET requests a day and would cost a fourth
enum member, a version negotiation and a new signed path into our money code.
Not worth it at this volume. If the ratio ever changes we will ask, and it will
be a conversation and not a surprise.

---

## 4. Nothing was built for the referrer, and nothing will be

Confirmed by search, not by memory: there is no route, handler or reference to
`/pay/go` anywhere in this repository outside the paragraph in
`docs/for-the-tech-store.md` that proposed it. Nobody started.

Your explanation is right and we have recorded the reason rather than the
verdict, which is the part that stops it coming back: a referrer is fixed when
the browser begins the navigation and is carried across redirects unchanged, so
a redirect can weaken it and can never substitute its own URL. The hop would
have looked like a fix and moved nothing.

`Referrer-Policy: no-referrer` on the checkout route stays as the whole of the
fix. Noted also that your `/pay/return` is a route handler rather than a page,
so the buyer passes through your domain without seeing it. That is the part we
would otherwise have asked about.

---

## 5. The 422 wording is recorded as staying

Written into `docs/payment-hub-contract.md` as a decision, not as an open
defect, so nobody waits on it.

Our side of that arrangement is unchanged and is the part that must not be
tidied away later: `hubInitialise` still sets `refused` on a 422 specifically,
the buyer still sees our own sentence about the email on their profile, and your
sentence is still kept on the payment row and in the error report where it is
useful rather than misleading. The comment above that code says why, so the next
person to read it does not "fix" it by passing your message through.

---

## 6. `/admin/hub` noted, and no search box needed yet

Recorded as the first place to look. The 100 row cap is not a problem at our
volume and the CSV covers the case where it would be, so please do not spend the
morning on a search box for us. If we ever need one it will be because something
has gone wrong, and we will ask then.

---

## One thing that was ours, found by reading your section 5

Your section 5 says a late payment is still settled correctly if one ever
arrives, because your settle function accepts a payment from any status except
`reversed`. Ours did not, and reading that sentence is what found it.

`confirm_subscription_payment` raised on any payment that was not `pending` or
already `confirmed`. So once we had closed a row, a genuine `payment.success`
arriving afterwards made our confirm endpoint answer 500. Your outbox would have
retried for 24 hours, given up, and a buyer who paid would hold no plan, with
nothing on either side reading as wrong: our row would say `failed`, which is
exactly what it would say if they really had walked away.

It needed two faults to bite, which is how the expensive ones always read
beforehand. Your window is 24 hours and ours is 48 and you ask Paystack before
closing anything, so the ordinary life of a stale payment is that you settle or
abandon it and we follow your verdict with a day to spare. The gap opened only
if your sweep went quiet past our 48 hours and a payment then turned up.

Fixed in migration 230, `a_payment_can_arrive_after_we_gave_up`. A `failed`
payment can now be confirmed, which matches your rule. `refunded` still refuses,
because money that was given back must not become a live plan again behind a
late event. A confirmation that arrives this way clears the failure reason and
raises a `late_payment_confirmed` alert, since somebody was told their payment
did not work and is now holding the plan. Four tests in
`tests/money/late-payment-confirmation.test.ts`, including the refund refusal.

Nothing is wanted from you for it. Your side was already right.

---

## Unchanged on our side

- Signing: `HMAC-SHA256` over `"<timestamp>.<request_id>.<raw body>"`, 300
  second window, request ids used once, comma separated secrets newest first.
  Still pinned to that exact string by `tests/money/hub-signing.test.ts`.
- The confirm endpoint still answers 2xx for anything a retry cannot improve,
  including a mismatch and an unknown reference, and non-2xx only for a fault on
  our side.
- Return URL still `https://sideperks.org/payments/return`. It changes before
  the route moves, not after.
- Fulfilment is still idempotent by payment id across all three entry points,
  your confirm POST, our return page and our sweep.

Thank you for the abandonment sweep and for the note. The 24 against 48
correction was the useful half: our comment had claimed for a fortnight that the
two numbers matched, and nobody would have looked.
