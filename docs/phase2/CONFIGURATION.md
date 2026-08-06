# Every number you can change

**Generated from the live database, 2026-08-06.** Migrations 107–136. Values are what is set right now, not
what the code defaults to.

Four places hold settings, and they are not interchangeable:

| Where | Scope | Changed from |
|---|---|---|
| `app_config` | Platform-wide | Admin → Settings |
| `products` | One product | Admin → Catalogue → that product |
| `training_programs` | One training course | Admin → Training |
| `affiliate_programs` | One product's commission | Admin → Catalogue → Commission |
| `tiers` | One ads plan | Admin → Plans |

⚠️ **`app_config` descriptions are printed next to the input box.** Two of them were found
wrong while writing this page (migrations 128 and 129) — both on money settings, both
understating what a number would cost. If you change how a money rule works, the
description is part of the change.

---

## 1. Phase 2 — affiliate marketing

### Platform-wide (`app_config`)

| Key | Now | Range | What it does |
|---|---|---|---|
| `affiliate_payouts_enabled` | **false** | — | Master switch: may commission be withdrawn at all. Independent of `payouts_enabled` |
| `commission_payout_minimum_minor` | **5000** = GHS 50 | 0 – 100,000,000 | Least withdrawable from a commission balance |
| `affiliate_default_l1_percent` | **30** | 0 – 100 | Level-one rate a *new* product starts with |
| `affiliate_default_l2_percent` | **10** | 0 – 100 | Level-two rate a *new* product starts with |

Commission shares the **platform withdrawal fee** — `redemption_fee_percent`, currently **10%** —
with points. One number, changed in one place (operator, 2026-08-06). It is frozen onto each
request when filed, so changing it never alters an amount already quoted.

Defaults only apply at creation. Changing them does **not** move any existing product.

### Per product (`products`)

| Column | Default | What it does |
|---|---|---|
| `price_minor` | — | List price, pesewas |
| `sale_price_minor` + `sale_starts_at` / `sale_ends_at` | none | Optional sale. **Commission is charged on what was actually paid**, so a sale reduces commission with it |
| `min_affiliate_tier` | `beginner` | Lowest training level allowed to promote it. `professional` restricts it |
| `content_language` | `en` | |
| `status` | `draft` | `draft` → `published` → `paused`. Publishing is refused while `product_publish_blockers()` returns rows — including, since migration 133, a course with **no lessons at all** |

### Per product's commission (`affiliate_programs`)

| Column | Default | Range | What it does |
|---|---|---|---|
| `l1_rate_value` | from config | 0 – 100 | Level one, **% of the amount paid** |
| `l2_rate_value` | 0 | 0 – 100 | Level two, **% of the same amount** |
| `attribution_window_hours` | **720** (30 days) | | How long a click stays creditable |
| `hold_days` | **0** | | Days a commission sits `pending` before clearing. 0 = clears immediately |
| `status` | `active` | | `paused` stops new commission without deleting history |

⚠️ **`l1 + l2` may not exceed 100.** That constraint is the only thing preventing a sale from
paying out more than it brought in — since migration 122 the arithmetic no longer prevents it
by itself. Level two is clamped to the remainder so rounding cannot add a pesewa.

⚠️ **`hold_days = 0` with a 14-day refund window** means commission can be withdrawn before
the sale is final. A refund then produces a negative balance, which blocks future payouts.
Raising this is the fix if it ever bites.

### Per training course (`training_programs`)

| | Beginner | Professional |
|---|---|---|
| Price | **GHS 150** | **GHS 400** |
| Renewal | **GHS 100** | **GHS 250** |
| `commission_depth` | **1** | **2** |
| `activation_threshold_percent` | **50** | **50** |
| `lesson_pass_percent` | **90** | **90** |
| `quiz_required` | **true** | **true** |
| `validity_days` | **365** | **365** |
| `grace_days` | **5** | **5** |
| `certificate_enabled` | **true** | **true** |
| Commission paid on selling it | **20% / 5%** | **20% / 5%** |
| Status | **draft** | **draft** |

Both courses are **`draft`** — not purchasable. That is the launch switch.

- `activation_threshold_percent` is lessons completed ÷ total lessons. Raising it does **not**
  deactivate anyone already active.
- `lesson_pass_percent` is how far into a video counts as watched.
- `commission_depth` is what the *buyer of this course* may earn, not what selling it pays.

⚠️ **Training pays 20/5 against a product's 30/10 — deliberately less.** That gap is the
answer to "does this reward recruiting over selling", and inverting it removes the answer.
See §6 of DECISIONS.md.

---

## 2. Phase 1 — the ads business

### Plans (`tiers`)

| Plan | Price | Band max | Multiplier | At band max | Daily ads |
|---|---|---|---|---|---|
| Free | 0 | — | ×1.000 | — | 1 |
| Bronze | GHS 65 | — | ×1.390 | — | 3 |
| Silver | GHS 140 | — | ×1.840 | — | 4 |
| Gold | GHS 250 | — | ×2.500 | — | 7 |
| Platinum | GHS 520 | **GHS 1,000** | ×4.120 | **×7.000** | 13 |

Platinum is a **band**: pay anywhere from GHS 520 to GHS 1,000 and the multiplier scales with
what you paid, between ×4.120 and ×7.000. The other four are single prices.

### Stacking

| Key | Now | Notes |
|---|---|---|
| `subscription_stacking_enabled` | true | |
| `subscription_max_stacked_plans` | 4 | |
| `subscription_multiplier_combine_mode` | `sum_bonus` | Each plan adds its bonus above the free rate |
| `subscription_max_combined_multiplier` | **10.000** | ⚠️ see below |
| `subscription_grace_period_days` | 3 | |

⚠️ **`subscription_max_combined_multiplier` is 10.000 and its own `max_value` is 10.** The
ceiling sits exactly at its bound, so it cannot be raised from the admin — a higher combined
rate needs a migration to widen the bound first. Worth fixing before it is discovered under
pressure.

### Money

| Key | Now | Notes |
|---|---|---|
| `points_per_currency_unit` | **100** | 100 points = GHS 1. Applied at redemption, forward-only |
| `redemption_minimum_points` | **5000** = GHS 50 | One minimum for every plan |
| `redemption_fee_percent` | **10** | Shared with commission. Frozen per request |
| `payouts_enabled` | **true** | Only `mark_redemption_paid` checks it |
| `redemption_holding_hours` | 0 | |
| `payout_details_change_cooloff_hours` | 48 | |
| `per_user_daily_points_cap` | 100,000 | |
| `reward_pool_daily_ceiling_points` | 1,000,000 | |
| `reward_pool_ceiling_blocks` | false | Alerts rather than stopping the platform |
| `crypto_payout_spread_percent` | 0 | |
| `fx_rate_max_age_hours` | 36 | Absorbs one missed daily refresh |

### Earning

| Key | Now |
|---|---|
| `earning_paused_globally` | false |
| `free_earning_days` | **21** — a free account stops earning after this; buying a plan lifts it |
| `ad_repeat_when_exhausted` | true |
| `ad_repeat_min_hours` | 0 |
| `ad_retry_cap` | 3 |
| `ad_targeting_includes_lower_tiers` | true |
| `ad_cooldown_seconds_default` | 0 |
| `link_dwell_seconds_default` | 15 |

### Referrals — ⚠️ every rate is **0**, so the whole programme pays nothing

| Key | Now | Level 2 |
|---|---|---|
| `referral_signup_bonus_points` | **0** | `..._l2` **0** |
| `referral_activation_bonus_points` | **0** | `..._l2` **0** |
| `referral_activation_ads_required` | 5 | |
| `referral_purchase_commission_percent` | **0** | `..._l2` **0** |
| `referral_purchase_commission_cap_points` | 0 (no cap) | |
| `referral_purchase_commission_scope` | `new_plans` | |

Level one is **flat** — the referrer's plan multiplier does not apply (migration 081).
Level two is paid **from the remainder** after level one. Note this is the *opposite* of the
Phase 2 rule, which pays both off the total. Two ladders that read alike and are not the same.

### Games, leaderboard, fraud, admin

| Key | Now |
|---|---|
| `games_enabled` | **true** |
| `game_plays_combine_mode` | `highest` |
| `game_min_seconds_between_plays` | 3 |
| `leaderboard_visible_ranks` | 100 |
| `leaderboard_counts_granted_points` | true |
| `leaderboard_shows_zero_earners` | false |
| `fraud_threshold_medium / high / critical` | 30 / 60 / 100 |
| `fraud_signal_decay_days` | 90 |
| `fraud_ip_velocity_max_signups` / `_window_hours` | 5 / 24 |
| `fraud_fingerprint_max_accounts` | 2 |
| `fraud_ad_failures_threshold` | 15 |
| `fraud_rapid_redemption_days` | 3 |
| `require_admin_2fa` | **false** |
| `two_factor_recheck_hours` | 12 |
| `admin_view_session_minutes` | 30 |
| `admin_hold_auto_return_hours` | 0 (indefinite) |
| `alert_on_payout_request` / `_critical_risk` / `_pool_ceiling` | all true |
| `team_shows_member_phone` | true |
| `support_messages_per_hour` | 20 |
| `gift_code_max_attempts_per_hour` | 10 |
| `currency_code` | GHS |

---

## 3. Numbers that are NOT configurable

These are in code. Changing one needs a deploy, so they are listed here to stop somebody
searching the settings screen for them.

| Number | Where | Why it is hardcoded |
|---|---|---|
| Expiry warnings at **30 / 7 / 1** days | migration 125 | Three sensible points; a setting would be three settings |
| Signed content URL lives **15 minutes** | `src/lib/content/access.ts` | Short enough that a copied link is not a distribution channel |
| Refund window **14 days** | order refund path | |
| Referral depth **2 levels** | schema — one `parent_affiliate_id` hop | ⚠️ **Deliberately unexpressible.** The legal clearance is for two levels. There is no recursion anywhere, so a third cannot be turned on by setting a number |
| Attribution **last click wins** | `record_click` ordering | The window is configurable; the rule is not |

---

## 4. What to set before going live

1. **Publish the two training courses** — both are `draft`, so nobody can buy either.
2. **Decide `affiliate_payouts_enabled`** — currently false, so commission accrues but cannot
   be withdrawn. Safe to launch that way and switch on later.
3. **Set the referral rates** — every one is 0, so the ads referral programme currently pays
   nothing to anybody.
4. **Widen `subscription_max_combined_multiplier`'s bound** if the ceiling ever needs raising.
5. **Consider `require_admin_2fa`** — false, with real money behind the admin.
