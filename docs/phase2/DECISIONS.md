# SidePerks Phase 2 — the decisions, and why

**Rebuilt 2026-08-06.** The original six documents lived in a Desktop folder and were lost;
this is the same content reconstructed into the repository, where it is versioned alongside the
code it describes.

**These decisions supersede `CLAUDE CODE PLAN phase2.md` wherever they differ.** The brief asked
questions; this answers them. Question IDs (A5, C16, B11a…) are the brief's Discovery numbering
and are kept so the two can be read together.

**How to read this with the code.** Every decision below is enforced somewhere specific, and the
migrations carry the reasoning at the point of enforcement. If the two ever disagree, the code is
what runs — treat that as a bug in one of them and fix it deliberately.

---

## 1. What Phase 2 is

A second business sharing one account: a closed vendor network selling digital products, promoted
by affiliates who must buy paid training first.

- **Vendors are offline.** The Owner enlists them, uploads their content, and creates the product.
  No vendor login, no portal, no self-serve (A2).
- **No vendor payable ledger** (A4). The Owner licenses the product outright; the system never
  tracks money owed to a vendor. Reporting is a CSV the admin exports and emails by hand (A3).
- **Anyone may buy.** Being an affiliate is not required to purchase.
- **Promoting requires paid training** — Beginner (one commission level) or Professional (two).

---

## 2. Money

### The commission base

**Commission is a percentage of what the buyer actually paid** — `orders.amount_minor`, not the
list price (C17, refined 2026-08-06).

A percentage of the list price can pay out more commission than a discounted sale brought in.
`list_price_minor` is stored alongside it so a report can show what a discount cost in commission
terms, and so the rule stays revisitable.

For an upgrade the amount charged **is** the difference, so no special rule is needed.

### Both levels come off the total

**Level one and level two are each a percentage of the whole sale** (operator, 2026-08-06,
uniform across training and vendor products).

This reversed an earlier decision that level two came out of the remainder. The reversal is
deliberate, and it moved a guarantee:

> The remainder rule made overpayment **arithmetically** impossible — level two could only take a
> slice of what level one had not. Paying both off the total means the guarantee holds because a
> constraint refuses rate pairs summing above 100%. Same safety today, **different kind**: if that
> constraint is ever loosened, this arithmetic can pay out more than came in.

Level two is clamped to what remains after level one, because two independent roundings at rates
summing to exactly 100% would otherwise pay a pesewa over — surfacing as a ledger that will not
balance.

### Rates

Percentage only (C14), **per product** (C13). The `type` column is stored anyway so adding
fixed-amount commissions later is a config change rather than a migration through money code.

Defaults for a new product: **30% / 10%**. Training pays **20% / 5%** — deliberately *below* the
product rate. See §6.

### No hold period

`hold_days = 0` (C19). The `pending → cleared` state machine still exists, so turning a hold on
later is a setting rather than new code.

⚠️ **The consequence the Owner accepted:** with no hold and a 14-day refund window (C20), a
commission can be withdrawn before the sale is final. A refund then leaves a **negative balance**,
which C21 says blocks future payouts rather than being written off.

### Attribution

- **Last click wins**, inside a **30-day** window (C18).
- Clicks bind **two ways** — a first-party visitor cookie *and* the account — so a click made while
  logged out still counts when they sign in to buy.
- **Self-referral pays nothing.** Given training itself pays commission, buying your own entry fee
  through your own link would be a discount funded by the programme.
- **Level two is resolved at the moment of the sale** (C22) and written onto the conversion row —
  never re-derived later from entitlement history that has since moved. A lapsed upline records
  depth 0 and earns nothing, and the record survives to answer a dispute.

### What never pays

- **Renewals, at any level** (B11c). An override paid every year for a single recruitment is
  residual recruitment income. The renewal leaves attribution before anything is written — a
  structural guarantee, not a check somebody has to remember.
- **Upgrades pay the upline, not the last click** (B8). An upgrade needs no click, so under
  last-click somebody could open a friend's link and move their own upgrade commission.

---

## 3. Training

| | Beginner | Professional |
|---|---|---|
| Price | GHS 150 | GHS 400 |
| Renewal | GHS 100 | GHS 250 |
| Commission levels | 1 | 2 |

Prices are **fixed, not ranges** (operator, 2026-08-06). Price *bands* are a Phase 1 plan concept;
a Phase 2 product has one price plus an optional sale price.

- **Buying is not activating** (B9). An affiliate account is created `pending` and switches on at an
  Owner-set **percentage of the course**, measured over lessons completed ÷ total lessons — not
  sections, not minutes. Currently **50%**.
- **A lesson counts when watched to 90% AND its quiz passed** (B10).
- **Activation is a one-way flip.** Publishing new lessons lowers everyone's percentage; an
  affiliate who already qualified stays qualified. Editing a course must not un-make affiliates.
- **Valid one year from PURCHASE** (B11, B11a), plus **5 days of grace** (B11e), with warnings at
  30 / 7 / 1 days.
- **The right to promote expires; the course does not** (B11). Two separate rows: permanent content
  access, time-limited promotion. Taking back a course somebody paid for invites refund demands.
- **Upgrading credits what they actually paid**, read off their order (B8). Somebody who bought
  Beginner on sale at GHS 100 pays GHS 300 to upgrade, not GHS 250.
- **Certificates** on finishing the **whole** course (B12) — not at the activation threshold, which
  is a different claim about a different amount of work.

---

## 4. Content

- **Streaming was rescinded** (E35). Plain files, an ordinary HTML5 player, playback speed and
  Picture-in-Picture — both native, and neither ever needed streaming.
- **Deterrent-level protection only** (E30). No DRM spend.
- ⚠️ **Paid content lives in a PRIVATE bucket** served by short-lived signed URLs after an
  entitlement check. Phase 1's `ad-media` is public — correct for an advert, catastrophic for a paid
  course, because a public bucket URL is permanent and unauthenticated.
- ⚠️ **`course-media` is gated on `is_super_admin`, NOT `is_admin`** (migration 134). The two are
  not the same function and the difference is a leak:

  | | Covers |
  |---|---|
  | `is_admin()` | super_admin, admin, **support**, **ads_manager** |
  | `is_super_admin()` | super_admin |

  `ad-media`'s policies use `is_admin()`, so copying that shape onto the course bucket is the
  obvious move and the wrong one — it would let anyone handling a password-reset ticket download
  every paid course the platform sells. Every catalogue RPC calls `assert_admin`, which is
  super-admin only; **the storage has to match the RPCs that write to it, or the weaker of the two
  is the real permission.**
- **The answer key has its own read.** `admin_lesson_detail` returns `isCorrect`;
  `lesson_for_learner` has no code path that can. Two functions rather than one with an
  `include_answers` flag, because such a flag would live in the function learners *can* reach.
- **Per-user watermark** on video and ebook pages (E31), carrying the viewer's identity. With
  streaming and DRM both declined, this is the only thing that makes a leak traceable.
- **Ebooks are text, not files** (E32). There is no column anywhere that could hold a path to a
  whole PDF, so nothing can later be "temporarily" served as one.
- **Read in app, never downloaded.** The reference screenshots show a download arrow on every row;
  that is the one thing deliberately not copied.
- **Two concurrent streams** (E34). *Not yet built — needs a playback-session table.*
- **Mobile web, no offline** (E33).

### Curriculum

Four item kinds — **video, article, reading (PDF resources), quiz** — in **one table**, ordered
together. A section quiz is a lesson of kind `quiz`. Two tables would mean two orderings to keep in
step and two progress records.

**In-video quizzes** are quizzes with an `at_seconds`; a video may carry several, and **every one**
must be passed before the lesson counts.

**Quizzes are marked on the server.** The client sends its choices and receives a score; the answer
key never leaves the database. Passing a quiz can complete a lesson, and completing lessons
activates an affiliate — a browser-scored quiz would be a browser-granted right to earn.

---

## 5. Affiliates and admin

- **Products carry a MINIMUM affiliate tier** (D23) — `beginner` or `professional`, compared as an
  ordered value so Professional is a strict superset.
- **Downline visibility matches the ads side** (D24), including full phone number and balance.
  ⚠️ See §7.
- **Public leaderboard on lifetime money**, net of reversals (D25). A board counting money later
  taken back credits people for refunded sales and is farmable.
- **Commission has its own withdrawal minimum** — GHS 50 (D26) — but **shares the platform
  withdrawal fee** with points (operator, 2026-08-06). One number, one place to change it.
- **Points and commission withdraw separately, always** (D27). Two currencies, two ledgers, two
  queues, and no view that sums them.
- **The Owner supplies all creatives** (D28). Affiliate-made marketing is where income claims
  appear, and those become the Owner's problem regardless of who wrote them.
- **Commission payouts ship behind their own flag**, off by default and independent of the points
  switch (H45).
- **Admin roles are business-scoped** (G42): super admin sees everything; appointed admins get a
  business and a duty.
- **UI references are deferred** (F40): backend first, references requested at four specific screens.
- **Affiliate mode is green** (F38) — but green already means *money in* on the ads side, so it needs
  a distinct shade or a chip becomes ambiguous.

---

## 6. ⚠️ The regulatory decision

**Training sales pay commission at both levels** (C16). The Owner decided this after the risk was
put to him twice, and reports that his lawyer has since reviewed the Phase 2 structure.

**Why it is the risky one.** Participants pay to take part, and earn when they recruit others who
also pay to take part. That is the structure regulators describe as a pyramid scheme, and a genuine
product alongside it does not by itself cure the analysis. The July clearance covered a programme
with **free** participation and **points** rewards; paid entry is the element that changes it.

**What was built to keep it defensible and reversible:**

1. **Training rates are their own settings**, so they can go to 0 from the admin with no deploy.
2. **Training pays LESS than vendor products** (20/5 against 30/10). The programme's own economics
   reward selling over recruiting. *If those rates are ever inverted, that answer disappears.*
3. **Two reports make it measurable** rather than assumed — the share of all commission coming from
   training rather than products, and the same per person, sorted so whoever earns mostly by
   recruiting sorts to the top.
4. **A third level is unexpressible** — one `parent_affiliate_id` hop, no recursion anywhere. The
   clearance is for two levels, and that is a structural property rather than a setting.
5. **Renewals pay nobody**, so no recruitment produces income indefinitely.

**The per-affiliate report is for flagging, not deciding.** A good recruiter who also sells looks
identical to a pure recruiter early on, because their downline has not sold yet. Nothing should
auto-suspend from it.

---

## 7. Open risks, recorded deliberately

**No affiliate terms or vendor agreement will be drafted** (H47). The versioned acceptance
*mechanism* is built regardless, because it cannot be added retroactively for people who already
joined. Two things that text eventually needs to carry:

- **The D24 disclosure.** An upline sees a downline's phone number and balance. Ghana's Data
  Protection Act governs disclosing one person's data to another, and consent is the simplest lawful
  basis. One paragraph at signup converts a surprise into something agreed to.
- **No income guarantee.** Without it, marketing copy is the only thing between the product and an
  earnings claim.

**No vendor agreement** means nothing is written down about whose loss a content leak is — while
protection is deterrent-level and the Owner holds the files. Worth revisiting before the first
vendor product goes on sale.

**Withholding is not implemented** (H48), but per-affiliate annual earnings are recorded and
exportable, so the figures exist if an obligation ever applies.

**There is no cron slot left.** The plan is Hobby: two jobs, daily only, both taken. Phase 2's
nightly maintenance rides on the existing `purge-deletions` route — a workaround, not a design, and
the one place Phase 2 is not purely additive.

---

## 8. Closed without an answer

**A1 — catalogue size at launch and at six months.** Carried on the open list for a while, and
withdrawn 2026-08-06 as a question that decides nothing.

It was being kept for three reasons, none of which survived checking:

- *Catalogue layout* — already decided by call 5 of DESIGN.md. Search is built in but does not
  lead, so the shelf handles ten products and does not have to be rebuilt for two hundred.
- *Query strategy* — the reads paginate from the first commit either way. Fetching a whole
  catalogue because it happens to be small today is exactly the thing that breaks quietly later.
- *Bandwidth* — plainly wrong. Bandwidth follows video minutes streamed, not the length of a list.

**And A2 already answers it.** Vendors are offline: the Owner enlists each one, uploads their
content and creates the product, with no vendor login and no self-serve. A catalogue where every
entry passes through one person by hand cannot be thousands of items. The closed-network decision
structurally caps the catalogue at the size the shelf assumes, so asking for the number was asking
the Owner to restate a decision already made.

**The affiliate green** was likewise resolved rather than answered — jade, see DESIGN.md call 2.
The operator may still override the exact pair, but nothing is waiting on it.

Nothing is currently blocked on an unanswered question.
