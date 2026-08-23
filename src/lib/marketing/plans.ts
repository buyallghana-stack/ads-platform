import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/database.types'

import { clientEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Public plan and rate figures for the landing page.
 *
 * Read from the database rather than typed into the marketing copy. The whole
 * page quotes money — prices, daily limits, the points-to-cedi rate, the
 * withdrawal threshold — and a hardcoded table drifts the moment the operator
 * edits a tier in the admin screen. Advertising a price the checkout no longer
 * charges is the kind of mistake that ends in a refund.
 *
 * This is a COOKIELESS anon client, deliberately. `createClient()` from
 * `supabase/server` reads `cookies()`, which opts the whole route into dynamic
 * rendering — and this page is the front door on Ghanaian mobile data, so it
 * wants to be cached HTML, not a per-visit render. Both `tiers` and
 * `app_config` carry anon-readable select policies (`is_active` on tiers,
 * `is_public` on config), so nothing here is privileged.
 */
function anonClient() {
  return createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export type MarketingPlan = {
  slug: string
  name: string
  description: string | null
  /** Major units (GHS), not minor. 0 for the free tier. */
  price: number
  currency: string
  months: number
  adsPerDay: number
  /** 1.5 means +50% points on every ad. What the FLOOR of the band pays. */
  rewardMultiplier: number
  /**
   * The top of the band, in whole cedis, and what paying it earns.
   *
   * A plan has been a price RANGE since 2026-08-04: what somebody pays inside
   * it sets what one ad is worth to them. Equal to `price` when the plan is a
   * single price, which is what `flexible` then reports.
   */
  bandMaxGhs: number
  bandMaxMultiplier: number
  flexible: boolean
  /**
   * What ONE ad is worth on this plan, in cedis, at the floor of the band and
   * at the top of it.
   *
   * The page quotes this instead of points because a new visitor has no idea
   * what a point is worth and every reason to distrust a currency they have
   * never seen. Derived from what the live ads actually pay and the peg, so a
   * retuned rate or a re-priced ad moves the front page with it.
   */
  perAdFrom: number
  perAdTo: number
  withdrawFrom: number
  isDefault: boolean
}

/** Which extras are switched on, so the page never advertises a closed door. */
export type MarketingFeatures = {
  games: boolean
  payouts: boolean
}

export type MarketingFigures = {
  plans: MarketingPlan[]
  features: MarketingFeatures
  /** What a typical ad pays before any plan multiplier, in points. */
  baseAdPoints: number
  free: MarketingPlan | null
  best: MarketingPlan | null
  /** Points that make up one cedi. */
  pointsPerCedi: number
  /** The one withdrawal minimum, for every plan. */
  withdrawFrom: number
  /** How long a free account earns for. */
  freeEarningDays: number
}

/**
 * A conservative fallback, used only if the database is unreachable at build
 * or revalidation time.
 */
const FALLBACK: MarketingFigures = {
  plans: [],
  features: { games: false, payouts: false },
  baseAdPoints: 100,
  free: null,
  best: null,
  pointsPerCedi: 1000,
  withdrawFrom: 5000,
  freeEarningDays: 21,
}

export async function getMarketingFigures(): Promise<MarketingFigures> {
  const supabase = anonClient()

  const [tiersRes, configRes] = await Promise.all([
    supabase
      .from('tiers')
      .select(
        'slug, name, description, price_minor, currency_code, billing_period_days, daily_ad_cap, reward_multiplier, redemption_minimum_points, is_default, sort_order, band_max_minor, band_max_multiplier',
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    /* Both keys are public, which is what lets the marketing page read them
       with the anonymous client at all. */
    supabase
      .from('app_config')
      .select('key, value')
      .in('key', [
        'points_per_currency_unit',
        'redemption_minimum_points',
        'free_earning_days',
      ]),
  ])

  /*
    THE PHASE 2 FIGURES COME THROUGH THE SERVICE CLIENT, and they have to.
    `products`, `training_programs`, `affiliate_programs` and `ads` all carry
    select policies granted `to authenticated`, so the anonymous key reads them
    as zero rows rather than as an error — a page that quietly advertised no
    training at all. The public product page has the same problem and solves it
    the same way.

    It costs nothing in caching: the service client reads no cookies, so this
    page stays as static as it was.
  */
  const admin = createAdminClient()
  const [privateConfigRes] = await Promise.all([
    admin
      .from('app_config')
      .select('key, value')
      .in('key', [
        'games_enabled',
        'payouts_enabled',
        'base_ad_points',
      ]),
  ])

  /* Read straight after the fetch, because more than one thing below needs it
     now: the feature switches AND the base an ad pays. */
  const privateConfig = new Map(
    (privateConfigRes.data ?? []).map((row) => [row.key, row.value]),
  )

  if (tiersRes.error || !tiersRes.data?.length) return FALLBACK

  /*
    THE BAND, DERIVED THE SAME WAY EVERYWHERE.

    `plan_band_max_minor` is the source of truth in SQL: a rung's ceiling is
    one pesewa below the next rung's price, and the TOP rung uses its own
    stored `band_max_minor`. The boundary is deliberately not symmetric, so it
    is written out here rather than guessed, and `marketing-bands.test.ts`
    asserts this agrees with the function.

    The displayed ceiling is floored to whole cedis, matching `PlanCard`: the
    upgrade screen offers Bronze up to GHS 139, so the front page must not
    advertise GHS 139.99.
  */
  const rows = tiersRes.data
  const bandOf = (index: number) => {
    const row = rows[index]
    const next = rows[index + 1]
    /* ⚠️ THE RUNG'S OWN CEILING FIRST (migration 189). The ladder has GAPS
       between the plans now — Bronze sells GHS 85 to 105 and Silver starts at
       145 — so a band no longer ends where the next one begins, and deriving
       it from the next rung advertised Bronze as running to GHS 144 on the
       front page. The next rung is the fallback for a continuous ladder. */
    const maxMinor =
      row.band_max_minor !== null
        ? Number(row.band_max_minor)
        : next
          ? Number(next.price_minor) - 1
          : Number(row.price_minor)
    const maxMultiplier =
      row.band_max_multiplier !== null
        ? Number(row.band_max_multiplier)
        : next
          ? Number(next.reward_multiplier)
          : Number(row.reward_multiplier)
    return { maxGhs: Math.floor(maxMinor / 100), maxMultiplier }
  }

  const plans: MarketingPlan[] = tiersRes.data.map((t, index) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    price: t.price_minor / 100,
    currency: t.currency_code,
    // Every paid plan is sold as a period of months, not days.
    months: Math.max(1, Math.round(t.billing_period_days / 30)),
    adsPerDay: t.daily_ad_cap,
    rewardMultiplier: Number(t.reward_multiplier),
    bandMaxGhs: bandOf(index).maxGhs,
    bandMaxMultiplier: bandOf(index).maxMultiplier,
    flexible: bandOf(index).maxGhs > t.price_minor / 100,
    /* Filled in below, once the live ad reward is known. */
    perAdFrom: 0,
    perAdTo: 0,
    // Overwritten below with the platform-wide minimum; the column is history.
    withdrawFrom: t.redemption_minimum_points,
    isDefault: t.is_default,
  }))

  const config = new Map((configRes.data ?? []).map((row) => [row.key, row.value]))

  /*
    ONE withdrawal minimum for every plan since 2026-08-01, so it is read from
    the config rather than from each tier's own column — which still holds the
    old per-plan numbers and is no longer what anybody is held to.
  */
  const withdrawFrom = Number(config.get('redemption_minimum_points'))
  const minimum = Number.isFinite(withdrawFrom) && withdrawFrom > 0 ? withdrawFrom : FALLBACK.withdrawFrom
  for (const plan of plans) plan.withdrawFrom = minimum

  const days = Number(config.get('free_earning_days'))
  const freeEarningDays = Number.isFinite(days) && days > 0 ? days : 21

  const parsed = Number(config.get('points_per_currency_unit'))
  const pointsPerCedi = Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK.pointsPerCedi

  /*
    What one ad pays before any multiplier. Taken from the ads that are live
    rather than from a constant, so the front page cannot promise a rate the
    feed stopped paying. Where they differ, the commonest value is the honest
    headline; where there are none, the peg's own unit keeps the page sane.
  */
  const baseAdPoints =
    Number(privateConfig.get('base_ad_points') ?? 0) || FALLBACK.baseAdPoints

  for (const plan of plans) {
    plan.perAdFrom = (baseAdPoints * plan.rewardMultiplier) / pointsPerCedi
    plan.perAdTo = (baseAdPoints * plan.bandMaxMultiplier) / pointsPerCedi
  }

  const on = (key: string) => privateConfig.get(key) === 'true'

  return {
    plans,
    baseAdPoints,
    features: {
      games: on('games_enabled'),
      payouts: on('payouts_enabled'),
    },
    free: plans.find((p) => p.isDefault) ?? null,
    // "Best" is the richest rate on offer, whatever the operator names it —
    // not a hardcoded 'platinum', so renaming a tier cannot break the page.
    best: plans.reduce<MarketingPlan | null>(
      (top, p) => (!top || p.rewardMultiplier > top.rewardMultiplier ? p : top),
      null,
    ),
    pointsPerCedi,
    withdrawFrom: minimum,
    freeEarningDays,
  }
}
