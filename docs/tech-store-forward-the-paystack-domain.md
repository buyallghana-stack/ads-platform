# Parked: forwarding `domain` from the Tech Store hub

Written 17 September 2026. **Not applied, deliberately.** Operator decision the
same day: wait for live Paystack keys and ship this with them, rather than
shipping it now.

## Why it is parked rather than done

The store's Paystack account is still in test mode. This change makes the hub
tell SidePerks so, and SidePerks already refuses to grant a plan against test
money. Landing it today would therefore stop every plan purchase until the keys
change, which is the guard working exactly as designed and still the wrong week
for it.

The cost of waiting is nothing, because the failure it prevents is already
happening and already understood: one plan, on the owner's own account, audited
and reconciled against the store's own intents on 17 September.

## The order to do it in, when the store owner's note arrives

The note will say only that the keys are switched. Then:

1. **Confirm the switch is real before trusting it.** Run
   `node scripts/audit-paystack-domain.mjs` in the tech-store repo. Section 2
   must say `live`. A key that was switched in one environment and not another
   looks identical from the outside, which is the whole reason this field
   exists.
2. **Apply the migration**, `docs/tech-store-forward-the-paystack-domain.sql` in
   this repo, to the store's database. It belongs in the store repo as
   `supabase/migrations/20260917110000_forward_the_paystack_domain.sql`.
   Renumber the timestamp if anything landed there first.
3. **Ship the TypeScript half** in the same deploy. The status read is a
   separate path from the confirm POST and a guard only one of them performs is
   a guard a page reload walks around.
4. **Take one real payment** and read it back. `domain` must arrive as `live`
   on the SidePerks side, visible in `hub_inbound_events.payload`. Verify by
   reading the stored record, not by reading the request builder: this project
   has been caught by that distinction before.
5. **Then the rehearsal.** Lost webhook, duplicate delivery, abandonment
   through the poll, the late success, and a reversal with the commission
   clawback. The store is holding that until live keys for the same reason this
   is parked.

⚠️ **Order matters, and switching keys comes first.** Shipping this before the
keys means every purchase is refused. Shipping it after means a short window
where live payments flow past a guard that cannot see them, which is exactly
where we are today and is survivable. So: keys, then this.

## The two traps, which are the reason this is not a one word change

**The snapshot is stale.** `hub_settle_intent` loads `v_intent` with
`select ... for update` at the top, and the notification is built from that
snapshot after the update has run. On a first settle `v_intent.paystack_payload`
is still null and the fresh transaction object is the `p_payload` argument. A
notification built from `v_intent.paystack_payload` carries `domain: null` on
every real payment, so the guard never fires and the work looks finished while
changing nothing. The line above it already solves this for `paid_at` with
`coalesce(v_intent.paid_at, v_now)`, and `domain` mirrors the update the same
way.

**The signature has to match to the argument.** The live function is
`(text, public.hub_intent_status, bigint, jsonb, public.hub_outbound_event)`,
with enums and that argument order. `create or replace` matches on the argument
list, so a version written from memory with `text` in place of the enums, or
with the arguments reordered, creates a **second overload** beside the first and
leaves the live one untouched. PostgREST then picks between them by argument
name. The staged SQL copies the header from `20260916072531` rather than
retyping it.

## The TypeScript half

`src/lib/hub/intents.ts` in the store repo, two edits.

The type at line 528:

```ts
export type IntentStatus = {
  reference: string;
  external_ref: string | null;
  status: Intent["status"];
  amount_minor: number;
  currency: string;
  /** `live` or `test`, straight off the Paystack transaction object. Null on an
   *  intent that never reached Paystack, which SidePerks reads as `unknown`. */
  domain: string | null;
  paid_at: string | null;
};
```

And `asStatus()` just below it:

```ts
function asStatus(intent: Intent): IntentStatus {
  return {
    reference: intent.reference,
    external_ref: intent.external_ref,
    status: intent.status,
    amount_minor: Number(intent.amount_pesewas),
    currency: intent.currency,
    domain: (intent.paystack_payload as { domain?: string } | null)?.domain ?? null,
    paid_at: intent.paid_at,
  };
}
```

`asStatus` reads the row after any `verifyAndSettle` has written to it, so the
stale-snapshot trap does not apply on this path. Worth stating, because the two
halves look like the same change and are not.

## What is already true on the SidePerks side

Shipped and live on 17 September, doing nothing until the above lands.

- `paystackMode` in `src/lib/payments/hub/decide.ts` reads `domain` at the top
  level and under `data`, `paystack`, `paystack_payload` and
  `provider_payload`. Absence reads as `unknown` and fulfils normally.
- A `test` verdict records the event, flags it as `test_mode` on the admin
  payments screen, grants nothing, and still answers the hub 2xx.
- `app_config.hub_accept_test_payments` is the rehearsal override, off, on the
  admin config screen under payout rules in red.
- Covered by `tests/money/hub-amount-guard.test.ts` and
  `hub-fulfilment.test.ts`, including the case that matters today: an
  unclassified payload still grants, which is all of them.
