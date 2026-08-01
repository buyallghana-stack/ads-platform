import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/database.types'

import { clientEnv } from '@/lib/env'

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
  /** 1.5 means +50% points on every ad. */
  rewardMultiplier: number
  withdrawFrom: number
  isDefault: boolean
}

export type MarketingFigures = {
  plans: MarketingPlan[]
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
 * or revalidation time. The page must still render — a marketing site that
 * 500s because a query timed out is worse than one quoting last week's
 * numbers — but these values are deliberately the *free* tier's, so a failure
 * under-promises rather than over-promises.
 */
const FALLBACK: MarketingFigures = {
  plans: [],
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
        'slug, name, description, price_minor, currency_code, billing_period_days, daily_ad_cap, reward_multiplier, redemption_minimum_points, is_default, sort_order',
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

  if (tiersRes.error || !tiersRes.data?.length) return FALLBACK

  const plans: MarketingPlan[] = tiersRes.data.map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    price: t.price_minor / 100,
    currency: t.currency_code,
    // Every paid plan is sold as a period of months, not days.
    months: Math.max(1, Math.round(t.billing_period_days / 30)),
    adsPerDay: t.daily_ad_cap,
    rewardMultiplier: Number(t.reward_multiplier),
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

  return {
    plans,
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
