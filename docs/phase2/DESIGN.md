# Phase 2 — the design system

**Written 2026-08-06.** The operator handed the design decisions over rather than supplying
references: *"the UI design is up to you. research for better ui design patterns… and try to
make meaning out of them."*

So this is not a mood board. It is the six calls that everything else follows from, each with
the reasoning that produced it, so a later screen can be checked against them and a later
decision can overturn one deliberately.

**What was studied:** the Udemy mobile course player (the operator's two screenshots, read
frame by frame), Udemy and Coursera on desktop, and the affiliate-portal conventions used by
Impact, Refersion, ShareASale and Post Affiliate Pro. What follows takes the parts that solve a
problem we actually have, and rejects the parts that solve a problem we do not.

**The existing system is not up for redesign.** `src/app/globals.css` is mature, documented and
meaning-coded, and Phase 2 must look like the same product. Everything below extends it.

---

## Call 1 — Two businesses, one shell, one switch

Phase 2 is not a feature. It is a second business with its own currency, its own audience and its
own laws, sharing a login with the first.

The obvious move — add an "Affiliate" item to the nav beside Games and Tasks — is wrong, because
it files a whole business under the same heading as a mini-game. It also puts both currencies in
one navigation, and the moment that happens somebody eventually builds a header that reads
"Your balance", which D27 forbids.

**The app has two modes: Earn and Market.** Each owns its own navigation. One persistent control
switches between them.

```
EARN                              MARKET
Dashboard · Ads · Tasks           Dashboard · Links · Courses
Games · Leaderboard · Team        Shop · Downline · Withdraw
Withdraw (points)                 (commission)
```

This is the Stripe test/live pattern, and it is the right borrowing because the thing it protects
against there — acting on the wrong data because two similar things shared a screen — is exactly
our risk with two currencies.

Three consequences that make it worth the cost:

- Most people only ever use one mode. A free user watching ads never needs affiliate navigation.
- The mode boundary is a **structural** guard on D27, not a rule somebody has to remember.
- It gives the affiliate identity a place to live that is not the individual chips.

**Someone with no affiliate account still sees the switch**, and it leads to the training sales
page. The switch is the product's own advertisement for its second business.

## Call 2 — Jade is the mode, green stays money

F38 says affiliate mode is green. But `success` green already means **money in**, platform-wide
and by fixed assignment. If affiliate chips are green, a green chip stops having one meaning.

**Resolution: jade is an identity colour, never a status colour.**

| | Hue | Used for |
|---|---|---|
| `success` #22c55e | yellow-green | money in — commission earned, paid out. Unchanged, both modes |
| `jade` #059669 | deep blue-green | Market mode identity only: the switch, active nav, section accents |

They are distinguishable side by side (jade is deeper and considerably bluer), but the separation
that actually holds is that **they are never used for the same kind of thing** — one fills a
status chip, the other marks a mode. Inside Market mode, money in is still `success` and money
out is still `danger`, exactly as in Earn mode.

Everything else keeps its platform-wide assignment: violet = plans, teal = account, orange =
referrals, brand blue = ads.

## Call 3 — The player is the product; on a phone it never leaves the screen

Read off the operator's screenshots, this is what Udemy gets right and why:

| Pattern | The problem it solves |
|---|---|
| Player **pinned to the top**, list scrolls beneath | You never lose the video while looking for the next lesson |
| Tabs under the player switch the *panel*, not the page | Changing what you are reading never interrupts playback |
| Row = number · title · one metadata line naming the kind **in words** | Four content kinds without inventing four icons nobody can read |
| Active row: tinted, bold, and "05:49 **remaining**" | The metadata line changes *meaning* for the active row — total time is useless once you have started |
| Complete = a check **before** the title | Progress reads down the left edge in one glance |

Three things in those screenshots we deliberately do **not** copy:

1. **The download circle.** Not merely because content is read in app (E32) — it is also the
   heaviest element on every row, so the least important action is the loudest thing on screen.
   Our right edge carries **state, not action**: a completion check, a lock, or a quiz score.
2. **Two interleaved numbering sequences.** Lectures run 14, 15, 16 while challenges run 1, 2
   between them. One list, one sequence.
3. **Low-contrast metadata.** Small grey on white is a poor bet on a cheap handset in daylight,
   which is the device this platform is actually used on.

**Desktop is a different layout, not a wider one.** Sticky-player-over-list is a phone answer to
a phone problem. At `lg` the curriculum becomes a rail *beside* the video, so structure and
content are visible at once — on the **right**, matching the operator's reference, because the
video is what you came for and it should take the natural left-to-right starting position.

## Call 4 — The in-video quiz replaces the frame, and cannot be scrolled away

The one interaction with no reference anywhere, so it is derived rather than borrowed.

Start from what it is for: **passing this quiz is part of what makes someone an affiliate who can
earn real money.** That single fact rules out the two obvious implementations — a dismissible
overlay, and a modal over a still-playing video — because both make it skippable.

**The video pauses and the quiz takes over the same rectangle.** Same position, same width;
nothing on the page moves. Seeking is disabled while it is open, so you cannot scrub past it.
Answer → the result appears in place → *Continue* resumes from the exact pause point.

A wrong answer **shows what was wrong and lets you try again**. It does not fail the lesson. The
quiz is a checkpoint proving attention, not an exam, and an unretryable question that costs you
your affiliate status is a support ticket every single time.

Because the player is sticky, the quiz inherits stickiness — which is the actual point:

> **A quiz you can scroll away from is a quiz you can skip.**

On a phone the frame is around 200px tall and a question plus four options does not fit in it, so
the block grows to the height it needs and pushes the list down. Replacing the frame allows that;
an overlay would not.

## Call 5 — A curated shelf, not a marketplace

Marketplace chrome — search-first, filter rails, star ratings, "12,481 students" — exists to make
*thousands* of items navigable and to substitute for trust between strangers. We have a closed
vendor network the Owner personally enlists, which is tens of products.

Copy that chrome onto ten products and the shop looks abandoned.

- **Cover-led cards on a shelf**, grouped by category. Big enough to be the reason you click.
- **Search exists but does not lead.** It appears above the shelf once the catalogue justifies it.
- **No ratings, no review counts, no enrolment numbers.** Nothing in the schema stores them, and
  an empty five-star row reads as broken rather than as new.
- **The affiliate-tier requirement is on the card**, not buried in the detail page — an affiliate
  browsing for something to promote is asking exactly that question.

## Call 6 — Design the states no reference will show you

Every affiliate platform has a handsome dashboard for a working affiliate. Almost none handle the
four states below, and on this platform all four are reachable on day one. This is where the
design earns its keep.

**Pending — bought the training, not yet 50% through.** The primary content is the **progress bar
to activation**, not a grid of zeroes. A new affiliate shown eight zeroed statistics learns
nothing and feels behind before starting. The one number that matters to them is how much course
is left.

**Negative balance.** Reachable because `hold_days = 0` and the refund window is 14 days: a
commission can be withdrawn and then refunded. `−GHS 40.00` on its own is alarming and
unexplained. It gets a card that says what was refunded, that payouts are paused until it clears,
and that nothing is owed personally.

**Expiring.** 30 / 7 / 1 days, escalating `warning` → `danger`, banner in Market mode only. Day
one is not the day to discover the entitlement was time-limited.

**Suspended.** Says who to contact. A dead-end screen with no route out generates a support
ticket by design.

The two derived metrics affiliates actually judge themselves on — **earnings per click** and
**conversion rate** — are shown, because a raw click count with no denominator tells someone
nothing about whether their promoting is working.

---

## Breakpoints

Three, matching the rest of the platform. Each screen is designed at all three, not scaled.

| | `base` phone | `md` tablet ≥768 | `lg` desktop ≥1024 |
|---|---|---|---|
| Shell | bottom nav, mode switch in header | bottom nav, wider gutters | left rail, mode switch at rail top |
| Course | sticky player over scrolling list | same, larger frame | curriculum rail beside video |
| Catalogue | 1 column | 2 columns | 3 columns |
| Dashboard | stacked cards | 2-up stats | 4-up stats + chart |
| Tables | stacked cards, no horizontal scroll | 2-up cards | real table |

The admin toolbar rule from Phase 1 still applies: more than three tabs goes to `xl`, and actions
never share a row with a tab strip.

## What building it actually caught

Three of these were invisible in the code and obvious on screen, which is the argument for
screenshotting every surface at every breakpoint rather than reasoning about class names.

| Found | Fix |
|---|---|
| **Balance GHS 248.00 above "Earned all time GHS 0.00."** Both correct by their own definition — `earned` counted only credits, and a manual adjustment is not a credit — and together nonsense. A balance cannot exceed what was ever earned, and anyone reading that concludes the platform has lost their money | Migration 132: `earned` counts credits **and** adjustments in the affiliate's favour; adjustments against them join `reversed`. The three lifetime figures now reconcile to the balance, and a test locks that property |
| **A video that fails to load rendered as nothing at all** — no player, no message, just a lesson page with a gap | A designed failure state filling the same 16:9 box, so the page does not reflow when a reload succeeds |
| **The threshold marker was a floating caption**, not drawn on the bar — the design claimed "a mark you can simply see" and delivered a sentence | A real tick on the track, taller than the bar so it reads as a gate |
| **The curriculum rail had no course header** — no title, no overall progress. Section completion answers "what is left in this part"; nothing answered "how far through am I" | Rail header with title, bar and `3 / 5` |
| `0 question(s)`, `1 file(s)` | ICU plurals, with `=0` collapsing to just "Quiz" |
| Content ran the full 1440px | `mx-auto max-w-6xl`, matching the ads dashboard |

## Non-negotiables carried from Phase 1

- Controls render at 16px on touch, or mobile Safari zooms in and does not zoom back out.
- Focus is replaced, never removed.
- `bg-canvas` / `bg-surface` rather than bare white, so sheets know how to be dark.
- Every screen designed in dark as well as light.
- No horizontal page scroll at any width; wide content scrolls inside its own container.
- Money is rendered by the existing formatter. Commission is `GHS 1,240.50`; points are
  `12,405 pts`. **Different units, different shape, never summed.**
