'use client'

import { useRef, useState } from 'react'

import { Check } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { PLAN_MARKS, SilverMark } from '@/components/onboarding/art/PlanMarks'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { UpgradePlan } from '@/lib/onboarding/data'

/**
 * The plans, as cards you swipe through.
 *
 * ⚠️ A CAROUSEL, NOT A COLUMN, AND NOT A TABLE. Four plans with five features
 * each is twenty rows; stacked on a phone that is a scroll nobody finishes,
 * and as a comparison table at 360px the columns are too narrow to hold the
 * numbers. One card at a time gives each plan the whole width, which is what
 * makes the price and the daily figure large enough to be the point.
 *
 * ⚠️ IT IS A SCROLLER, NOT A JAVASCRIPT SLIDER. `scroll-snap` does the paging
 * natively, so it has real momentum, it works with a trackpad and a keyboard,
 * and it cannot desynchronise from its own index the way a hand-rolled slider
 * does. The dots follow the scroll rather than driving it.
 *
 * ⚠️ NO FREE CARD (operator, 2026-09-23). Everybody reading this is on the
 * free plan already.
 */

/**
 * A colour per plan.
 *
 * Kept here rather than on the tier row on purpose: an operator renaming a
 * plan or adding one should never be able to produce an unreadable card. Every
 * head takes INK text, so each colour only has to be distinct, not legible
 * against white, and a plan with no entry falls back to the brand.
 */
const HEADS: Record<string, string> = {
  bronze: '#FDBA74',
  silver: '#A5B4FC',
  pearl: '#F9A8D4',
  gold: '#FDE047',
}
const HEAD_FALLBACK = '#93C2FD'

export function PlanCarousel({
  plans,
  freeDailyGhs,
  onChoose,
}: {
  plans: UpgradePlan[]
  freeDailyGhs: number
  onChoose: (slug: string) => void
}) {
  const t = useTranslations('onboarding.upgrade')
  const format = useFormatter()
  const scroller = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const money = (n: number) =>
    format.number(n, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })
  /* Prices are whole cedis on every rung, and "GHS 85.00" wrapped the pill
     onto a second line at 360px. Decimals that are always .00 cost a line and
     buy nothing. */
  const price = (n: number) =>
    format.number(n, {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    })

  /* The dots read the scroll rather than steering it, so they can never
     disagree with what is on screen. */
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const card = el.scrollWidth / Math.max(plans.length, 1)
    setIndex(Math.round(el.scrollLeft / card))
  }

  const goTo = (i: number) => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ left: (el.scrollWidth / plans.length) * i, behavior: 'smooth' })
  }

  return (
    <div className="-mx-6">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {plans.map((plan) => {
          const Mark = PLAN_MARKS[plan.slug] ?? SilverMark
          const head = HEADS[plan.slug] ?? HEAD_FALLBACK

          /* Every line is a real per-plan figure. Nothing here is a slogan:
             a feature list on a paid screen that says "great value" instead of
             a number is the thing people stop believing. */
          const features = [
            t('feature.earn', { from: money(plan.dailyFromGhs), to: money(plan.dailyToGhs) }),
            t('feature.ads', { count: plan.dailyAdCap }),
            t('feature.points', { from: plan.pointsFrom, to: plan.pointsTo }),
            t('feature.games', { count: plan.weeklyGamePlays }),
            t('feature.term', { days: plan.termDays }),
            t('feature.referral', { percent: plan.referralBonusPercent }),
          ]

          return (
            <article
              key={plan.slug}
              className="w-[min(19rem,82vw)] shrink-0 snap-start overflow-hidden rounded-(--radius-panel) bg-surface"
            >
              {/* The head: plan, mark, and the band as a pill. Straight from
                  the operator's flyer, which is the shape they asked for. */}
              <div className="px-5 pb-5 pt-4" style={{ background: head }}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[1.375rem] font-bold tracking-[-0.01em] text-ink-900">
                    {plan.name}
                  </h3>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-900/15 p-2 text-ink-900">
                    <Mark />
                  </span>
                </div>

                <p className="mt-1.5 min-h-[2.5rem] text-[0.8125rem] leading-snug text-ink-900/70">
                  {plan.description}
                </p>

                <p className="mt-3 inline-flex rounded-full bg-surface px-4 py-2 text-[0.9375rem] font-bold tabular-nums text-ink-900">
                  {plan.priceFromGhs === plan.priceToGhs
                    ? price(plan.priceFromGhs)
                    : t('band', { from: price(plan.priceFromGhs), to: price(plan.priceToGhs) })}
                </p>
              </div>

              <div className="px-5 pb-5 pt-4">
                <p className="text-[0.75rem] font-bold uppercase tracking-[0.08em] text-ink-500">
                  {t('includes')}
                </p>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {features.map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-ink-900"
                        style={{ background: head }}
                      >
                        <Check className="size-2.5" strokeWidth={4} />
                      </span>
                      <span className="text-[0.8125rem] leading-snug text-ink-700">{line}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="md"
                  fullWidth
                  className="mt-4"
                  onClick={() => onChoose(plan.slug)}
                >
                  {t('choose', { plan: plan.name })}
                </Button>
              </div>
            </article>
          )
        })}
      </div>

      {/* Dots. Buttons, not decoration, so a plan is reachable without a swipe
          and the whole thing works from a keyboard. */}
      <div className="mt-3 flex items-center justify-center gap-2">
        {plans.map((plan, i) => (
          <button
            key={plan.slug}
            type="button"
            onClick={() => goTo(i)}
            aria-label={plan.name}
            aria-current={i === index ? 'true' : undefined}
            className={cn(
              'h-2 rounded-full transition-all',
              i === index ? 'w-6 bg-white' : 'w-2 bg-white/35 hover:bg-white/55',
            )}
          />
        ))}
      </div>

      <p className="mt-4 px-6 text-center text-[0.8125rem] leading-relaxed text-white/60">
        {t('vsFree', { amount: money(freeDailyGhs) })}
      </p>
    </div>
  )
}
