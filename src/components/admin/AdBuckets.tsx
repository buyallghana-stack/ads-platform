'use client'

import { useMemo } from 'react'

import { AlertTriangle, Check, Clock, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { AdListItem, TierOption } from '@/lib/admin/types'

/**
 * One bucket per plan, and whether each one is ready for today.
 *
 * Operator, 2026-08-12: *"each band tier; free, bronze, silver, gold, platinum
 * has their own ads bucket that will make it easier for me to add the ads in
 * there … that one was more clustered making it difficult what ads serve what
 * tier."*
 *
 * ── WHY THIS IS A BOARD AND NOT A FILTER ──
 *
 * A filter answers "show me the Bronze ads". The question actually being asked
 * is "is Bronze ready for today", which no filter can answer because the
 * answer is a COMPARISON: how many ads a Bronze member can see against how many
 * they are allowed to watch. That number is the whole product of this screen,
 * so it is the thing on it.
 *
 * ── THE ARITHMETIC, AND THE ONE SUBTLETY ──
 *
 * Since migration 188 targeting is EXCLUSIVE: an ad tagged to Bronze is for
 * Bronze holders only. But an ad tagged to NOBODY is still shown to everybody,
 * which is what keeps the existing pool serving — so what a Bronze member can
 * actually see is `bronze bucket + untagged`. The headline is that sum, because
 * it is what the member experiences, and the split is printed underneath so the
 * operator can see which part is theirs to fill.
 *
 * Counted the same way `eligible_ad_ids` counts: live status, inside its
 * schedule, and not already at its completion limit. A screen that says four
 * when the feed says three is worse than no screen.
 */

type Bucket = {
  tier: TierOption
  own: number
  scheduled: number
  available: number
  needed: number
}

const liveNow = (ad: AdListItem, now: number) =>
  ad.status === 'active' &&
  (ad.startsAt === null || Date.parse(ad.startsAt) <= now) &&
  (ad.endsAt === null || Date.parse(ad.endsAt) > now) &&
  (ad.budget === null || ad.completions < ad.budget)

const scheduledLater = (ad: AdListItem, now: number) =>
  ad.status === 'active' && ad.startsAt !== null && Date.parse(ad.startsAt) > now

export function AdBuckets({
  ads,
  tiers,
  serverNow,
}: {
  ads: AdListItem[]
  tiers: TierOption[]
  serverNow: number
}) {
  const t = useTranslations('admin.ads.buckets')

  const { buckets, everyone, everyoneScheduled } = useMemo(() => {
    const now = serverNow
    /* `tiers` on an ad is a list of NAMES (the data layer maps slugs through
       the tier table), so the match is by name. */
    const untagged = ads.filter((a) => a.tiers.length === 0)

    const everyoneLive = untagged.filter((a) => liveNow(a, now)).length
    const everyoneLater = untagged.filter((a) => scheduledLater(a, now)).length

    const buckets: Bucket[] = [...tiers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tier) => {
        const mine = ads.filter((a) => a.tiers.includes(tier.name))
        const own = mine.filter((a) => liveNow(a, now)).length
        return {
          tier,
          own,
          scheduled: mine.filter((a) => scheduledLater(a, now)).length,
          available: own + everyoneLive,
          needed: tier.dailyAdCap,
        }
      })

    return { buckets, everyone: everyoneLive, everyoneScheduled: everyoneLater }
  }, [ads, tiers, serverNow])

  const short = buckets.filter((b) => b.available < b.needed)

  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h2>
        <p className="text-[0.75rem] text-ink-500">{t('subtitle')}</p>
      </div>

      {/* The warning first, because a short bucket is the only thing on this
          board that needs doing today. Naming the plans saves a scan. */}
      {short.length > 0 && (
        <p
          role="status"
          className="mt-2.5 flex items-start gap-2 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-warning-600"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('short', {
            plans: short.map((b) => b.tier.name).join(', '),
            n: short.length,
          })}
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {buckets.map((b) => {
          const ready = b.available >= b.needed
          const fill = b.needed > 0 ? Math.min(b.available / b.needed, 1) : 1
          return (
            <div
              key={b.tier.id}
              className={cn(
                'rounded-(--radius-card) border bg-surface p-3.5',
                ready ? 'border-ink-200' : 'border-warning-500/40',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.875rem] font-semibold text-ink-900">{b.tier.name}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[0.75rem] font-semibold tabular-nums',
                    ready ? 'text-success-700' : 'text-warning-600',
                  )}
                >
                  {ready ? (
                    <Check aria-hidden className="size-3.5" />
                  ) : (
                    <AlertTriangle aria-hidden className="size-3.5" />
                  )}
                  {t('ofLimit', { available: b.available, needed: b.needed })}
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    ready ? 'bg-success-500' : 'bg-warning-500',
                  )}
                  style={{ width: `${Math.round(fill * 100)}%` }}
                />
              </div>

              {/* Whose ads make up that number. The operator fills the first
                  part; the second is the untagged pool everybody sees. */}
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-500">
                {t('breakdown', { own: b.own, everyone })}
              </p>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                {b.scheduled > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[0.6875rem] text-ink-500">
                    <Clock aria-hidden className="size-3.5" />
                    {t('scheduled', { n: b.scheduled })}
                  </span>
                ) : (
                  <span className="text-[0.6875rem] text-ink-400">{t('noneScheduled')}</span>
                )}

                <Link
                  href={{ pathname: '/admin/ads/new', query: { tier: b.tier.slug } }}
                  className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-700 transition-colors hover:border-brand-600 hover:text-brand-700"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {t('add')}
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-ink-400">
        {t('everyoneNote', { n: everyone, scheduled: everyoneScheduled })}
      </p>
    </section>
  )
}
