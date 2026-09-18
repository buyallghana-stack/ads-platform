# The live keys: what to do, in what order

Written 17 September 2026, the day the live Paystack keys arrived. The parked
`domain` change (`tech-store-forward-the-paystack-domain.md`) ships inside step
2 of this list and not before, because landing it while the store is still in
test mode refuses every plan purchase.

**Do not paste a secret key into a chat. Install it in the Vercel dashboard.**
A key pasted into a conversation is in a transcript, and this project has
already had to rotate one PAT for that reason.

Two things about running commands: a line the operator runs with `!` has three
times now not taken effect, and the `!` shell opens in the stale
`/mnt/c/.../Desktop/Ads` checkout, so every command needs `cd ~/projects/ads &&`
in front of it. Anything below that is not a browser step, ask me to run.

## 1. The store takes the live keys (nothing else happens first)

1. **Paystack dashboard, switched to LIVE mode.** Copy the secret key, the one
   starting `sk_live_`. The store's code reads only the secret key:
   `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is in its `.env.example` and is referenced
   nowhere in `src`, because the charge is opened server side.
2. **Vercel, the `tech-store` project, Settings then Environment Variables.**
   Set `PAYSTACK_SECRET_KEY` for **Production only** to the live key. Leave
   Preview and Development on the `sk_test_` key. A preview deployment that can
   charge a real card is a preview deployment nobody can safely click.
3. ⚠️ **The webhook URL is a PER MODE setting in Paystack.** Test mode and live
   mode each have their own, and the live one is empty on an account that has
   only ever run in test. Set it to
   `https://techstoreghana.com/api/webhooks/paystack`. Without it the store
   never hears a `charge.success`, and although its own sweep would eventually
   ask Paystack directly, the buyer sits on a spinner until it does.
4. **Redeploy the store's production.** Changing a variable does not touch the
   deployment already running, which keeps the old key until it is rebuilt.
   This is the step that looks done and is not.
5. **Prove the switch is real before trusting it.** Take one small live payment
   on the store, then run `node scripts/audit-paystack-domain.mjs` in
   `~/projects/tech-store`. Section 2 must print `live`. The rows already there
   keep saying `test` forever, so only a NEW row is evidence, and a key
   switched in one environment and not another looks identical from the
   outside. That is the entire reason this field is being forwarded.

## 2. The parked change, in the same deploy window

Both halves together. The status read and the confirm POST are separate paths,
and a guard only one of them performs is a guard a page reload walks around.

- **Migration.** `docs/tech-store-forward-the-paystack-domain.sql` in this repo
  belongs in the store repo as
  `supabase/migrations/20260917110000_forward_the_paystack_domain.sql`. The
  store's last migration is `20260916230956`, so that timestamp is still free.
  Diffed against the live `20260916072531_hub_settle_intent.sql` on 17
  September: the only change is the `domain` line and the repeated `revoke`,
  and the header matches the live signature argument for argument.
- **TypeScript.** `docs/tech-store-forward-the-paystack-domain.patch`, checked
  with `git apply --check` against store commit `8a8b54f`, applies cleanly.
  It adds `domain` to `IntentStatus` and to `asStatus()` in
  `src/lib/hub/intents.ts`.
- ⚠️ **Writing into `~/projects/tech-store` is blocked for me**, by Bash and by
  the editor alike, which is why both halves are staged here instead. Applying
  the patch and copying the migration file is an operator step, or a step for a
  session that has write access to that repo.

## 3. SidePerks gives up its Paystack key

Operator decision, 17 September: this app stays keyless. Its one remaining
direct Paystack call is the Vault card deposit, which hands Paystack a
`sideperks.org/vault/callback` URL and metadata naming a vault plan. That was
survivable against test money. Against live money it breaks the rule the whole
hub exists to keep.

1. **Remove `PAYSTACK_SECRET_KEY` from the `ads-platform` Vercel project**, in
   every environment, and redeploy. I could not read that project's variables
   from here: the CLI answers `Not authorized`, so the local `.env.local`
   holding an `sk_test_` key is all I can see. Check production in the
   dashboard rather than assuming.
2. What that changes, and nothing else: the Vault card button stops rendering
   (`checkoutEnabled` on the vault page), and a Vault plan is bought with
   balance, which is the whole product anyway. `/api/payments/paystack/webhook`
   answers 503, and nothing points at it.
3. ⚠️ **This was NOT safe until today's commit.** The upgrade page gated the
   plan pay button and the coupon field on `Boolean(PAYSTACK_SECRET_KEY)`, a
   question that stopped being the right one the day plans moved to the hub.
   Removing the variable would have hidden the pay button on every plan, with
   no error and no log, and the page would have said "not yet" to every buyer.
   The gate now asks `hubConfigured()`. Pinned by
   `tests/money/checkout-gate.test.ts`.
4. Do not add the variable back to this project to make a missing button
   reappear. Either leave it off, or move the Vault onto the hub the way
   `upgrade/actions.ts` was moved.

## 4. Read it back, then rehearse

- One real plan purchase, end to end. Then `node scripts/audit-hub-test-money.mjs`
  in this repo: section 5 must stop saying `domain  NOT SENT`, and section 6
  must show `"domain": "live"` in a stored payload. Read the record, not the
  request builder. This project has been caught by that distinction twice.
- If `domain` arrives as `test` after the switch, nothing is granted, the event
  is flagged `test_mode` on the admin payments screen, and the hub still gets a
  2xx. That is the guard working. Go back to step 1.4, because it means
  something is still running the old key.
- **Then the rehearsal both sides have been holding:** lost webhook, duplicate
  delivery, abandonment through the poll, the late success, and a reversal with
  the commission clawback. For a rehearsal that needs test money to be accepted
  on purpose, `app_config.hub_accept_test_payments` is the override, on the
  admin config screen under payout rules. Turn it back off afterwards.

## 5. The Vault, proven the same way (18 September 2026)

Step 3 above said the Vault would either stay off or move onto the hub. It
moved: commit `286c264`, no Paystack call left in this repository that a buyer
can reach. What follows is the plan proof repeated for a deposit, and the order
is not optional.

⚠️ **The migration must reach production BEFORE the code does.** Migration 232
(`20260880000000_the_vault_pays_through_the_hub.sql`) is applied to
`sideperks-test` only. Production has none of its three functions, both status
constraints still narrow, and no `payment_kind` column. Deploying first breaks
the checkout at `attach_vault_hub_reference`, after the hub has already opened a
payment at Paystack, and makes `/api/internal/hub/confirm` fail its own event
row on every settlement.

1. **Check what production actually has.**
   `cd ~/projects/ads && node scripts/audit-vault-hub-deposit.mjs`
   Section 0 names the database by project ref, section 1 answers yes or no per
   function. Read section 0 every time: `SUPABASE_DB_URL` is the TEST project,
   and mistaking it for production is a mistake this feature has already
   produced once.
2. **Apply migration 232 to production.** `scripts/apply-sql.mjs` reads
   `SUPABASE_DB_URL` and therefore cannot do it. This is a deliberate, operator
   confirmed step. Re-run the audit afterwards: section 1 must be four yeses and
   both constraints must list `refunded` and `cancelled`.
3. **Deploy.** ⚠️ This makes the Vault card button appear in production for the
   first time. It has been hidden since the live keys arrived, because it was
   gated on a `PAYSTACK_SECRET_KEY` this app does not hold, and it is now gated
   on `hubConfigured()`, which is true in all three environments.
   `vault_enabled` is already `true`.
4. **One small live deposit**, cheapest plan, real money, a real phone. The
   buyer is sent to the STORE's Paystack page and comes back to
   `https://sideperks.org/payments/return`, which is the plan's return URL: the
   hub allowlists return addresses and the Vault could not be given its own.
   The page should say Vault, not plan, and its button should go to /vault.
5. **Read the record back.** `node scripts/audit-vault-hub-deposit.mjs` again.
   The verdict must be empty, and in particular:
   - section 4 must print `domain live`. `test` means a key somewhere is still
     the old one and nothing should have been granted.
   - section 5 must show exactly one `active` investment with the right maturity
     date and return.
   - section 6 must print `kind=vault`. If it says `subscription`, the admin
     flags screen will read the buyer's name from the wrong table.
6. **Then the reversal rehearsal**, which is the half no plan test covers. A
   matured vault has already paid points out, and `reverse_vault_payment` takes
   back only what is there, never pushes a balance negative, and raises
   `vault_clawback_short` naming the shortfall.
   `tests/money/vault-hub-settlement.test.ts` pins all of that against a real
   database; doing it once with real money is still worth it.
