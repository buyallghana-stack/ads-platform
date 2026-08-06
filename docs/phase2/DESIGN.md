# Phase 2 — the design system

**Rewritten 2026-08-06 (third version).** The two earlier versions are gone, and it is worth saying
why before anything else, because the reason is the most useful thing in this file.

- **v1** built Market and Shop out of the ads design system with a green accent. The operator's
  verdict: generic. The diagnosis is in the method rather than the taste — *affiliate screens
  assembled from ads parts come out looking like ads screens with green in them.*
- **v2** replaced it with a cream/true-black palette derived from a set of reference screenshots.
  It was closer and still wrong, and the operator's verdict on the whole tree was
  *"rip off the entire ui of the affiliate marketing"*. Every line of it was deleted (commit
  `51bc5bd`, 4,155 lines).
- **v3**, this one, is built from four new assets the operator supplied on 2026-08-06 and from
  three decisions they took directly. It is the version that shipped.

> **"the affiliate business does not inherit the design pattern of the ads"** — operator, 2026-08-06

---

## The assets, and what each one settled

| | What it is | What it contributed |
|---|---|---|
| **IMG_0583** | Affiliate dashboard, dark violet | The whole palette; the earnings panel; the funnel strip; the training card |
| **IMG_0584** | Product marketplace, dark violet | Card anatomy — cover, save, commission + cash, primary action |
| **IMG_0585** | Two-plan paywall, light blue | The join screen's structure: two offers, feature lists, order summary |
| **IMG_0582** | Udemy curriculum, light | Section/lesson list anatomy: number, kind, duration, completion mark |

Two of the four are drawn light and two dark. **That difference was treated as an artefact of how
they were generated, not as intent** — the operator confirmed it (see Decision 1). What was taken
from all four is composition, hierarchy and card anatomy.

The assets are AI-generated and were treated as a brief, not a spec. Where an asset showed something
the platform cannot honestly support, it was dropped rather than faked. That accounts for most of
the differences listed at the end of this file.

---

## The three decisions the operator took

Asked on 2026-08-06, before any code was written.

**1 — Dark violet, everywhere.** The affiliate mode is a dark violet surface end to end:
dashboard, marketplace, learn, statement, account. The earlier "jade marks the mode" decision is
**retired**. The one exception is `/p/[slug]`, which is not in the mode at all — see Call 3.

**2 — Quick Tools ships only what exists.** The reference's five-tile row includes Banners, Promo
Tools and Reports, none of which have a backend. They were dropped rather than greyed out. A
shortcut strip is scanned, not read; three dead tiles in five means most of what the eye lands on
does nothing, and the two live ones get *slower* to find rather than faster.

**3 — Both training programmes go live.** Beginner (GHS 150, one commission level) and
Professional (GHS 400, two), so every screen is verifiable against real data instead of mocks.

---

## Call 1 — The skin is a token block, not a component set

`.affiliate` in `globals.css` redefines the semantic colour tokens on **one wrapper**: the
`(affiliate)` route group's layout div. Custom properties inherit, and a declaration on a descendant
beats the one on `html`, so it wins over both `:root` and `.dark` — in either theme, with no `dark:`
utilities involved.

Every primitive in this codebase is already written against those tokens: `bg-surface`,
`border-ink-200`, `text-ink-900`, `bg-brand-600`. None of them names a colour. So a `Card` rendered
inside that wrapper is violet-dark without a single line of `Card` being touched, and a primitive
fixed once is fixed in both businesses.

The alternative — a parallel set of `Affiliate*` components — is how the two halves of an app drift
apart: a focus ring corrected in one and not the other, a radius that stops matching, two spinners.
It is also exactly what v1 did, and what got stripped.

**The `brand` ramp is remapped to violet**, not left alone. That is the move that makes every
primary button, focus ring, active tab and link the mode's colour for free. `brand` means "this
product's colour", and in here the product is the other one.

> ⚠️ **Never use a `dark:` utility inside the affiliate tree.** `dark:` keys off the class on
> `<html>`, which reports the *user's theme*, not this subtree's. In light mode it silently does
> nothing and the element renders light-on-dark. Tokens are the only thing that knows where it is.

`color-scheme: dark` is set on the wrapper as well as on `html`, so native selects, scrollbars and
date pickers inside it are drawn dark even when the rest of the app is light.

**Money colours do not change per business.** `success` still means money in and `danger` money out;
the commission percentage on every product card is green. Only the *accent* violet is pushed to
fuchsia, so the "premium" chip and the primary button are not the same colour and both keep a
meaning.

---

## Call 2 — Same navigation anatomy, different destinations

Bottom tab bar under `md`, slim sidebar above it, five destinations either way — identical in shape
to `AppNav`, because the two businesses share a login and a person moving between them should not
have to learn a second set of gestures. What differs is the skin and the destinations, which is the
point: you can tell which business you are in without reading a word.

| | Route | |
|---|---|---|
| Dashboard | `/market` | what you have earned, and what to do next |
| Products | `/shop` | what there is to promote |
| Learn | `/learn` | the training, which is also the activation gate |
| Earnings | `/commission` | the statement, and getting paid |
| Account | `/market/account` | code, programme, expiry, commission depth |

**The reference has "Referrals" where Learn is.** Reassigned deliberately: an affiliate account does
not switch on until the course is `activation_threshold_percent` complete, so Learn is on the
critical path for every single user. A recruit list is not — it is empty for everybody on the
Beginner programme, whose commission depth is 1. The L2 network appears as a figure on the dashboard
and a section inside Earnings, where it belongs to the money it explains.

The mode switch is pinned in the sidebar on `md+` and sits in the header on a phone. It is a **link**
and not a toggle: mode is derived from the URL and never stored, and a control that looks stateful
beside a mode that is not is how you end up claiming somebody is somewhere they are not.

---

## Call 3 — `/p/[slug]` is in neither mode

The public product page — where every affiliate link lands — is **outside** the affiliate route
group, renders in the main brand's light skin, and is reachable signed out.

`/shop/[slug]` is behind the auth gate and wears the workspace UI. Pointing a shared link there
would send every prospect to a login wall wrapped in a tool they have no account for. So affiliate
links are built as `/{locale}/p/{slug}?ref={code}`, and the affiliate's own view of the same product
is a separate screen with a promote panel on it.

That page is also the only Phase 2 screen that is **indexable**. Every signed-in screen carries
`robots: { index: false }`; hiding the shopfront from search would be hiding the shopfront.

---

## Call 4 — One route, five screens

`affiliate_dashboard` returns a `state`, and each state is a genuinely different page rather than the
same page with a banner on it:

| state | what renders |
|---|---|
| `none` | the offer, and only the offer. There is no dashboard to show. |
| `pending` | what is still required, and nothing else |
| `lapsed` | the dashboard, plus a banner saying why nothing new is arriving |
| `suspended` | the balance, and who to ask |
| `active` | the dashboard |

They share a URL because they are the same *destination*, so a link to `/market` never hits a
redirect chain that loses where somebody came from. They do not share a layout, because a dashboard
reading four zeros under a "you have not joined" banner is worse than no dashboard: it teaches the
reader that the figures on this screen might be meaningless.

The same rule governs the promote panel's four refusals — no account, pending, lapsed, wrong tier.
Each gets its own sentence and its own next step. One greyed button covers none of them.

---

## Call 5 — Two figures, never one total

The earnings panel carries **total earned** and **available to withdraw**, at different sizes, on
different surfaces, with the Withdraw button inside the second one's card.

An affiliate reading the big figure and tapping Withdraw expecting that amount is the single most
predictable complaint this screen can generate, and layout is the only thing that prevents it. The
same rule holds on `/commission`: available and clearing sit side by side and are never added.

The three lifetime figures below them are laid out as an arithmetic that can be checked by eye —
`earned − reversed − paid = balance + pending` — because that identity was once violated on screen
(a balance of GHS 248 above "Earned all time: GHS 0.00", both individually correct and together
nonsense; migration 132).

---

## Call 6 — A dual-axis chart, which is normally the wrong answer

The ads dashboard's chart deliberately refuses two y-scales: with two scales the point where the
lines cross is an artefact of the scaling, and readers consistently read meaning into it.

It is the right answer here. Clicks are the **input** and earnings the **output** of the same funnel,
and the entire question an affiliate has is whether the second follows the first. Splitting them
across two cards makes the reader do that comparison from memory, which is the one thing a chart
exists to prevent.

The standard mitigation is applied: each axis is drawn in its own series' colour, and the gridlines
belong to the left axis only. Both series are gap-filled in SQL, so a flat stretch means nothing
happened rather than nothing was recorded — a line drawn across absent days claims activity there
was none.

The funnel strip above it reads left to right — clicks, people, sales, rate — in one card rather than
four, so a responsive grid cannot reflow it out of order and destroy the only structure it has.

---

## Call 7 — Every number on a card is a real column

The product card's two figures — commission rate and cash per sale — come from `shop_products`, and
the cash is `round(price * rate / 100)` computed **in Postgres**, with the same expression
`pay_conversion_commissions` uses.

Never multiplied in a browser: a JavaScript float and an exact numeric disagree on half a pesewa, and
the card would advertise GHS 60.01 against a ledger that pays GHS 60.00. Small, permanent, and
precisely the kind of discrepancy an affiliate keeps a screenshot of.

The grid's default sort is by **cash**, not rate — 20% of GHS 400 beats 35% of GHS 100, and sorting
by percentage would put the worse product first.

---

## What the references show that we deliberately do not

Each of these was a choice to say nothing rather than to say something the database cannot confirm.

| Reference shows | Why it is not here |
|---|---|
| Star ratings | No review system. A rating decided by nothing is worse than no rating. |
| "Trending" badges | No popularity signal yet. Same reason. |
| "Most Popular" on a plan | No sales. On a screen taking GHS 400 that fabrication is the one that matters most. The fuller programme is marked as *"Pays on two levels"* — what is actually true of it. |
| Digital / Physical / Services tabs | Everything in the catalogue is digital. Tabs that all return the same grid teach the reader that the controls do nothing. The tabs are `product_kind` — Courses, E-books, Bundles — plus Saved. |
| Banners / Promo Tools / Reports | No backend. Operator's ruling: ship the two that are real. |
| "Secure & trusted: industry-leading encryption" | A sentence about the payment processor dressed as a sentence about the product. Replaced with *how you get paid* — when the money clears and whether it can be taken back, which is the question somebody actually has before paying to become an affiliate. |
| "Unlock your earning potential" | The headline of a product that will not say what it does. Replaced with the actual proposition. |
| Six ticks per plan | The two programmes differ in exactly one field — `commission_depth`. Padding the list to six means inventing five, and a feature list that has to be padded is one the reader will discover is padded. |
| A "This Month ▾" dropdown | Three periods, all visible, one tap each, state in the URL. A dropdown hides three options behind a tap and costs more than it saves. |

---

## Where things live

```
src/app/[locale]/(affiliate)/        the whole mode; the layout mounts `.affiliate`
  market/            dashboard, join, and market/account
  shop/              marketplace and the affiliate's product view
  learn/             entitled courses
  commission/        statement and payouts
src/app/[locale]/p/                  PUBLIC product page + payment callback — not in the mode
src/components/affiliate/            everything the mode renders
src/lib/market/                      reads, money formatting, mode helpers, attribution
```

Migrations behind these screens: **147–152**. Each adds a read; none stores a derived figure.
