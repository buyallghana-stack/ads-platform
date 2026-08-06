# Phase 2 — the design system

**Rewritten 2026-08-06**, replacing the first version wholesale.

The first version got the central call wrong. It said *"Phase 2 must look like the same product"*
and built Market and Shop out of the ads system with jade as a mode accent. The operator's verdict
was that it looked generic — and the diagnosis is in the method, not the taste: **affiliate screens
assembled from ads parts come out looking like ads screens with green in them.**

> **"the affiliate business does not inherit the design pattern of the ads"** — operator, 2026-08-06

So this is a second design language living in the same codebase, derived from six references the
operator supplied. Mobile first, as instructed; tablet and desktop derived here.

---

## What the references actually are

| | What it is | What it contributes |
|---|---|---|
| **0571** | Stacks+ paywall, light **and** dark | The whole palette decision: cream canvas, near-black pill CTA, **true-black** dark |
| **0572** | LMS mobile — home, course, my-courses | Cover-led cards, chip filters, progress rails |
| **0576 / 0577** | Course player, desktop | Left rail with progress + accordion sections; **pill** tab group under the video |
| **0578** | Course sales page, desktop | Sticky commercial column; benefits in two columns; "earn your certificate" panel |
| **0579** | Coursera enrol, mobile | **The bordered offer panel** — the single most reusable idea here |

Two of the six are course players we have already built to a different reference. They are kept
because they agree with the others on the things that matter: rounded everything, pill tabs, an
icon in a rounded square on every list row.

---

## Call 1 — Cream, not slate. Black, not navy.

The ads app is blue-on-slate: `canvas #f1f5f9`, dark is `#0a0f1c` navy. Every screen built on it
inherits that temperature, which is why the affiliate screens read as ads screens.

Market takes the 0571 palette instead:

| | Ads | Market |
|---|---|---|
| Canvas (light) | `#f1f5f9` cool slate | `#faf8f5` **warm cream** |
| Canvas (dark) | `#0a0f1c` navy | `#0a0a0a` **true black** |
| Primary action | brand blue | **near-black** in light, **jade** in dark |
| Radius (card) | 14px | **20px** |
| Buttons | 10px radius | **full pill** |

This is a **skin**, not a fork. `.market-skin` overrides the same custom properties the components
already read — `--color-canvas`, `--color-surface`, `--radius-card` — so every existing primitive
picks it up without a second copy of `Card`, `Badge` or `Button` existing anywhere. One class on a
layout changes the entire language beneath it.

**Jade survives** as the accent, because F38 is an operator decision and nothing has rescinded it.
What changed is everything around it: it is no longer a green highlight on a blue app, it is the
accent of a warm, dark-CTA, heavily-rounded language that shares no surface with the ads side.

## Call 2 — The bordered offer panel

The one idea worth taking whole, from 0579. A commercial offer sits inside its **own bordered,
tinted panel** — not loose on the page, not a bare button:

```
┌─────────────────────────────────┐
│  Purchase Course                │   what this panel is
│  US$31.00                       │   the number, large
│  ✓ benefit                      │   what you get, checked
│  ✓ benefit                      │
└─────────────────────────────────┘
```

It works because it separates *the offer* from *the description of the product*, which is exactly
the distinction a shopper is making. Everything commercial on the Market side now uses it: the
purchase panel, the promote panel, the training offer on the dashboard.

## Call 3 — Promote and Purchase are two panels, not two buttons in a row

> **"affiliates should be shown two buttons, promote, purchase"** — operator, 2026-08-06

The literal reading is two buttons side by side. That is the wrong shape, and the references say
why: two equal buttons in a row asks *"which of these do you want"*, but these are **not
alternatives**. They are two entirely different relationships with the same product — one is
spending money, the other is earning it — and a person arrives already knowing which they are.

So each gets its own offer panel (call 2), stacked:

- **Buy** — price, what you get, "Buy now".
- **Promote** — what you earn per sale in cash, the rules that govern it, "Copy my link".

Stacked panels also answer the question the buttons cannot: an affiliate who cannot yet promote
this product needs to know *why*, and there is no room for that under a button.

Order on the page: **Promote first for an active affiliate**, purchase first for everybody else.
An affiliate opening a product page is far more often deciding what to share than what to buy.

## Call 4 — The promote panel states cash, not percentages

A rate is a fact about the programme. A cash figure is a fact about *this sale*, and it is the one
an affiliate is actually working out — badly, in their head, on a phone.

So the panel leads with **"You earn GHS 30.00 per sale"** and puts "20% of GHS 150.00" underneath
as the working.

⚠️ **That figure is computed in Postgres** (`affiliate_promote_info`), with the same price source
and the same rounding `pay_conversion_commissions` uses. Multiplying in the browser would let the
number an affiliate is shown drift from the number they are paid — and the shown one is the one
they screenshot.

Three things sit under it because each answers a question that otherwise becomes a support message:

- **the window** — "the link is remembered for 30 days"
- **when it clears** — hold days, currently zero
- **the second level**, only for a Professional, because showing a locked level-two figure to a
  Beginner is an advert for an upgrade dressed as information

## Call 5 — Four reasons, not one "no"

There are four distinct ways to be unable to promote something, and each needs a different sentence
and a different next step:

| Reason | What the panel says | Where the button goes |
|---|---|---|
| `no_account` | you need the training first | the training product |
| `pending` | finish enough of the course | the course |
| `lapsed` | your year ran out | renewal |
| `tier` | this one needs Professional | the upgrade |

`affiliate_promote_info` returns the reason rather than a boolean for exactly this. A single
`canPromote: false` would collapse all four into "no", which is the least useful thing the screen
could say to somebody who wants to give us money.

## Call 6 — The dashboard is an overview, and only once there is something to overview

> **"if no purchase of the training program is made should only display the pricing there, and
> after purchase should show an overview or stats of their performance"** — operator, 2026-08-06

This confirms the state machine already built, and sharpens what belongs in each state:

- **No training** — the two courses and their prices. Nothing else. No empty stat grid, no
  explanation of a programme they have not joined.
- **Pending** — progress to activation, and nothing that would read as performance.
- **Active** — money first, then performance: balance, sales, clicks, earnings per click,
  conversion rate.

What changes from the first build is the *rendering*: stat tiles become the reference's card
language — larger figures, rounded panels, a warm canvas — rather than the ads dashboard's tighter
slate grid.

---

## Breakpoints

Mobile is the designed case; the other two are derived.

| | `base` phone | `md` tablet | `lg` desktop |
|---|---|---|---|
| Product page | one column, offer panels beneath the content, CTA in the panel | same, wider gutters | **two columns** — content left, offer panels sticky right (0578) |
| Shop | one column of cover-led cards | 2 columns | 3 columns |
| Dashboard | stacked panels | 2-up stats | 4-up stats |
| Promote | **bottom sheet** | bottom sheet | inline panel, no sheet |

The promote sheet is a phone answer to a phone problem — a panel that would push the page down
below the fold. From `lg` there is room for it in the right-hand column and the sheet disappears.

## Carried over unchanged

The Phase 1 non-negotiables are platform rules, not ads-design decisions, and all still apply:
16px controls on touch, focus replaced never removed, `bg-canvas`/`bg-surface` rather than bare
white, both themes designed, no horizontal page scroll, and money rendered by the shared formatter
— `GHS 1,240.50` for commission, `12,405 pts` for points, never summed.
