# Money-critical tests

`pnpm test`

These cover the paths where a bug costs real money: the points ledger and the
redemption pipeline. §8 calls them a release blocker. Everything in here was
previously verified by hand, once, in a session that has since ended — which
protected nothing against the next change.

## One thing to set up

They talk to Postgres **directly**, not through the Supabase client, because
almost every function they exercise (`credit_points`, `debit_points`,
`request_redemption`, `approve_redemption`, `mark_redemption_paid`) is revoked
from every client-reachable role. That is the property that makes those
functions worth having, and a test that reached them through a browser-shaped
client would be testing a door that is supposed to be locked.

So they need a database connection string:

```
SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
```

Get it from **Supabase dashboard → Project Settings → Database → Connection
string → URI**, and use the **session** pooler on port 5432, not the
transaction pooler on 6543 — every test runs inside a transaction, which the
transaction pooler does not hold across statements.

⚠️ The pooler hostname is per project and is not always `aws-0`. The test
project is on `aws-1-eu-west-3`, and the management API hands back the
transaction pooler on 6543 rather than the session one, so read the host from
the string it gives you and change the port yourself.

Put it in `.env.local`. Without it the suite fails loudly on a single guard
test rather than skipping quietly, because a green run that silently skipped
the payout tests is worse than a red one.

## Which database

**`sideperks-test` (`yejmkyciynzmqvtnhapf`), never production.**

This used to read "the shared dev project", and it was true when it was
written. That project was later renamed `sideperks-production` because a live
database called "dev" is how somebody eventually runs something destructive on
it, and the rename happened without the tests moving. For two months this
suite wrote to the live database on every run.

`tests/support/db.ts` now throws if `SUPABASE_DB_URL` names the production
project, so pointing it back is not something that can happen by accident.

The test project is built from the same migrations, by
`scripts/replay-migrations.cjs`, and `scripts/diff-schema.cjs` compares the two
schemas: tables, columns, functions, triggers, enums, RLS and policies. Run
that diff after any migration, because a test database that quietly differs
from production turns every green run into evidence about the wrong system.

⚠️ It is a free-plan project, so it **pauses after seven days idle** and needs
one click in the Supabase dashboard to wake. A paused database looks like a
connection failure, not a paused project.

## How they avoid leaving a mess

Cleanup is the hard part, not the tests:

- `points_ledger` is append-only by trigger and refuses `DELETE` to every role
  **including the table owner**.
- Any user with ledger rows cannot be deleted at all — `ON DELETE RESTRICT`,
  migration 007.

A suite that inserted money and then tried to tidy up after itself would be
permanently wedged after its first run. So nothing is ever cleaned up:
`withRollback` opens a transaction, hands it to the test, and rolls it back in
a `finally`. Fixtures, ledger entries, redemptions and config changes all
disappear together, and the append-only trigger is never asked to permit
something it exists to refuse. A failing test cleans up exactly as thoroughly
as a passing one.

Two consequences worth knowing before adding tests here:

1. **Nothing can commit.** A test that needs to observe a real commit is in the
   wrong harness.
2. **They run serially** (`fileParallelism: false`). Several tests change
   `app_config` rows, and two transactions doing that concurrently deadlock
   rather than fail cleanly.

## What they will not catch

They test the database. The server actions, the RLS policies as a *browser
token* experiences them, and the UI are not covered here — the one exception is
`admin_list_redemptions`, which is called under `set local role authenticated`
to prove a non-admin is turned away.
