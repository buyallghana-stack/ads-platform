'use client'

import { useState } from 'react'

import { useFormatter, useTranslations } from 'next-intl'

import { PLAN_MARKS, SilverMark } from '@/components/onboarding/art/PlanMarks'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { UpgradePlan } from '@/lib/onboarding/data'

/**
 * The plans, as one screen you choose from.
 *
 * ⚠️ THIS REPLACED A CAROUSEL, AND THE CAROUSEL WAS THE PROBLEM. Four fat
 * cards carrying five bullets each, swiped one at a time, is the shape every
 * template ships and it fails the one job a paywall has: nobody can compare
 * plans they cannot see at the same time, and a price is meaningless without
 * the one beside it. The operator's word for it was that it looked generated,
 * which is what a layout looks like when it was chosen before the content was.
 *
 * What the reference libraries and the conversion write-ups agree on, and what
 * this does instead:
 *
 *   ONE SCREEN, ONE ACTION. Every plan visible at once, one primary button.
 *   COMPARABLE. Same row shape, the deciding number in the same place, so the
 *     eye runs down a column instead of holding four cards in memory.
 *   ONE RECOMMENDED, and said out loud rather than implied by colour.
 *   FEW BENEFITS, and only for the plan actually selected. A feature list per
 *     card is twenty lines nobody reads.
 *
 * The metal tones survive as the mark on each row. As full card headers they
 * were four loud blocks fighting each other; at 32px they read as a ladder.
 */

const TONES: Record<string, string> = {
  bronze: '#8A4B22',
  silver: '#475569',
  pearl: '#6B4E7D',
  gold: '#8A6A18',
}
const TONE_FALLBACK = '#0052C9'

export function PlanPicker({
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

  /* The cheapest rung is selected first: this screen appears seconds after
     somebody earned one cedi, and the smallest true number is the one that
     belongs next to that. */
  const [chosen, setChosen] = useState(plans[0]?.slug ?? '')
  const plan = plans.find((p) => p.slug === chosen) ?? plans[0]

  const money = (n: number) =>
    format.number(n, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })
  const price = (n: number) =>
    format.number(n, {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    })

  /* Badged on merit, not on a guess about what sells: it is the rung that pays
     the most per ad of everything on sale. */
  const best = plans.reduce((a, b) => (b.pointsTo > a.pointsTo ? b : a), plans[0])

  if (!plan) return null

  return (
    <div className="flex flex-col gap-2.5">
      {plans.map((p) => {
        const Mark = PLAN_MARKS[p.slug] ?? SilverMark
        const tone = TONES[p.slug] ?? TONE_FALLBACK
        const selected = p.slug === chosen

        return (
          <button
            key={p.slug}
            type="button"
            onClick={() => setChosen(p.slug)}
            aria-pressed={selected}
            className={cn(
              'flex w-full items-center gap-3 rounded-(--radius-card) border px-3.5 py-3 text-left transition-colors',
              selected
                ? 'border-brand-400 bg-brand-600/15'
                : 'border-white/10 bg-white/5 hover:border-white/25',
            )}
          >
            {/* The radio is drawn rather than an <input>, because the whole row
                is the control and a real radio beside it would be a second,
                smaller target for the same thing. */}
            <span
              aria-hidden
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full border-2',
                selected ? 'border-brand-400' : 'border-white/30',
              )}
            >
              {selected && <span className="size-2.5 rounded-full bg-brand-400" />}
            </span>

            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full p-1.5 text-white"
              style={{ background: tone }}
            >
              <Mark />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-white">{p.name}</span>
                {p.slug === best?.slug && (
                  <span className="rounded-full bg-brand-400/20 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.06em] text-brand-300">
                    {t('bestRate')}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[0.75rem] text-white/50">
                {p.priceFromGhs === p.priceToGhs
                  ? price(p.priceFromGhs)
                  : t('band', { from: price(p.priceFromGhs), to: price(p.priceToGhs) })}
              </span>
            </span>

            {/* The deciding number, in the same place on every row. */}
            <span className="shrink-0 text-right">
              <span className="block text-[1.0625rem] font-bold tabular-nums text-white">
                {money(p.dailyFromGhs)}
              </span>
              <span className="block text-[0.6875rem] text-white/45">{t('perDay')}</span>
            </span>
          </button>
        )
      })}

      {/* What the CHOSEN plan gives, and only that. Four lines, not twenty. */}
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-(--radius-card) bg-white/5 px-4 py-3.5">
        {[
          t('feature.ads', { count: plan.dailyAdCap }),
          t('feature.games', { count: plan.weeklyGamePlays }),
          t('feature.points', { from: plan.pointsFrom, to: plan.pointsTo }),
          t('feature.term', { days: plan.termDays }),
        ].map((line) => (
          <p key={line} className="text-[0.75rem] leading-snug text-white/70">
            {line}
          </p>
        ))}
      </div>

      <Button size="lg" fullWidth className="mt-2" onClick={() => onChoose(plan.slug)}>
        {t('continueWith', { plan: plan.name })}
      </Button>

      <p className="text-center text-[0.75rem] leading-relaxed text-white/45">
        {t('vsFree', { amount: money(freeDailyGhs) })}
      </p>
    </div>
  )
}
