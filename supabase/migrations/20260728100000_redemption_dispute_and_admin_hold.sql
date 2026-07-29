-- ============================================================================
-- Migration 049 — the two states the payout screen needs and the database
-- could not yet express
--
-- Split from the functions that use them (migration 050) for one reason:
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds
-- it. Postgres will accept the statement and then refuse every later
-- reference to the new label until that transaction commits. Two files is the
-- supported way round it, not a stylistic preference — merging them back
-- together is how this breaks on a fresh database.
--
--
-- 1. `disputed`
-- -------------
-- The admin UI has offered a dispute since it was designed: after a payout is
-- marked paid the operator has 48 hours to contest it, and after that the
-- action disappears. `src/lib/admin/types.ts` carries the status with a
-- comment saying the database does not have it yet. This is that gap closing.
--
-- A dispute MOVES NO MONEY, and that is deliberate. By the time one is
-- raised the cash has left and the points were debited at request. Refunding
-- the points would hand the user their money and their points; clawing back
-- automatically would act on a suspicion. So `disputed` records a contested
-- payment, who contested it and why, and stops there. Any correction after
-- the investigation is a deliberate, separately audited adjustment.
--
--
-- 2. The admin hold
-- -----------------
-- `held` already existed, but it meant one specific thing: inside the
-- fraud-catch window, waiting for `release_matured_holds` to sweep it into
-- the review queue. An operator holding a request they have questions about
-- is a different event that happens to land on the same word.
--
-- Without distinguishing them the sweep silently undoes the operator: it
-- moves every `held` row whose `holding_until` has passed back to
-- `pending_approval`, and an admin hold placed on a matured request has a
-- `holding_until` that is by definition already in the past. The operator
-- would hold it, and it would reappear in the queue within the minute.
--
-- The fix is in `holding_until` rather than in a new predicate on the sweep:
-- an indefinite admin hold parks the clock at `infinity`, which the existing
-- `holding_until <= now()` can never match. That leaves the sweep exactly as
-- it was — no second rule about which held rows it is allowed to touch — and
-- makes a timed hold fall out for free, since a real timestamp there is
-- already handled.
-- ============================================================================


alter type public.redemption_status add value if not exists 'disputed' after 'failed';


-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
--
-- The dispute gets its own three columns rather than reusing `reviewed_by` /
-- `review_notes`. Those describe the approval decision, and a dispute is
-- raised AFTER an approval that already filled them in. Overwriting would
-- erase who approved the payment at the exact moment somebody needs to know.

alter table public.redemptions
  add column if not exists admin_hold_at timestamptz,
  add column if not exists disputed_at   timestamptz,
  add column if not exists disputed_by   uuid references auth.users (id) on delete set null,
  add column if not exists dispute_reason text;

comment on column public.redemptions.admin_hold_at is
  'When an operator placed this request on hold. Distinguishes an admin hold from the automatic fraud-catch hold every request starts in — the two share the `held` status but not the meaning.';

comment on column public.redemptions.disputed_at is
  'When a paid-out payment was contested. A dispute records a contested payment; it moves no points and reverses nothing on its own.';

create index if not exists redemptions_disputed_idx on public.redemptions (disputed_at desc)
  where disputed_at is not null;
create index if not exists redemptions_disputed_by_idx on public.redemptions (disputed_by)
  where disputed_by is not null;


-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------
--
-- Both windows are config rows rather than constants because the operator has
-- to be able to move them without a deploy, and because the UI already treats
-- the dispute window as a number it is told rather than one it knows.
--
-- `admin_hold_auto_return_hours` defaults to 0 = indefinite: a request an
-- operator has questions about should wait for an answer, not quietly
-- re-enter the queue on a timer while the question is still open. Setting any
-- positive value turns it into a timed hold, handled by the existing sweep.

insert into public.app_config (key, value, value_type, min_value, max_value, is_public, description) values
  ('payout_dispute_window_hours', '48', 'int', 1, 720, false,
   'How long after a payout is marked paid an operator may still contest it. Enforced in dispute_redemption, not only in the UI.'),
  ('admin_hold_auto_return_hours', '0', 'int', 0, 720, false,
   'How long an operator-placed hold lasts before the request returns to the review queue by itself. 0 means the hold is indefinite and only an operator can lift it.')
on conflict (key) do nothing;
