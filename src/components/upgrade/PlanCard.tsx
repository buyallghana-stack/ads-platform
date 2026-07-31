'use client'

import { Check, Gem, Zap } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { Plan } from '@/lib/subscriptions/data'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * One purchasable plan.
 *
 * Plans are a stack, not a ladder, so the card never says "upgrade to" or
 * implies the next one replaces this one. A held plan keeps its place in the
 * grid with its end date, because when it lapses is the thing its owner
 * actually wants to know.
 *
 * Violet is the plan colour across the product (Home upgrade teaser, Profile
 * promo), so it carries through here rather than each surface inventing one.
 */
export function PlanCard({
  plan,
  held,
  endsAt,
  recommended,
  previousName,
  previousDailyAdCap,
  pointsPerCurrencyUnit,
  onChoose,
}: {
  plan: Plan
  held: boolean
  endsAt: string | null
  recommended: boolean
  /** The plan one rung below this one — Free for the cheapest paid plan.
   *  Each card says what THIS step buys over the last one, because that is
   *  the decision somebody on Bronze is actually making. Comparing every
   *  plan to Free made the top plans look like huge jumps and the middle
   *  ones look redundant. */
  previousName: string
  previousDailyAdCap: number
  /** Points to one cedi, for showing the payout threshold in money. */
  pointsPerCurrencyUnit: number
  onChoose: () => void
}) {
  const t = useTranslations('upgrade')
  const format = useFormatter()

  const price = format.number(plan.priceMinor / 100, {
    style: 'currency',
    currency: plan.currencyCode,
    maximumFractionDigits: 0,
  })

  /*
    Expressed as percentages with a worked example rather than "x1.10".
    A multiplier is an abstraction; "+10% — a 50-point ad pays 55" is the same
    fact in a form someone can check against the ad they just watched.
    EXAMPLE_AD_POINTS sits in the middle of the seeded ads (35–80 points).
  */
  const EXAMPLE_AD_POINTS = 50
  const ratePercent = Math.round((plan.rewardMultiplier - 1) * 100)
  const examplePays = Math.round(EXAMPLE_AD_POINTS * plan.rewardMultiplier)
  const extraAds = plan.dailyAdCap - previousDailyAdCap

  const benefits = [
    {
      icon: Zap,
      text: t('benefits.ads', { count: plan.dailyAdCap }),
      hint: extraAds > 0 ? t('benefits.adsHint', { extra: extraAds, plan: previousName }) : null,
    },
    {
      icon: Gem,
      text: t('benefits.rate', { percent: ratePercent }),
      hint: t('benefits.rateHint', { base: EXAMPLE_AD_POINTS, paid: examplePays }),
    },
    {
      icon: Check,
      text: t('benefits.payout', { points: format.number(plan.redemptionMinimumPoints) }),
      hint: t('benefits.payoutHint', {
        money: format.number(plan.redemptionMinimumPoints / pointsPerCurrencyUnit, {
          style: 'currency',
          currency: plan.currencyCode,
          maximumFractionDigits: 0,
        }),
      }),
    },
    /* The "+X% on referral bonuses" benefit was removed on 2026-07-30, when
       referral bonuses became flat for everyone. Only ad earning scales with a
       plan now — a card promising something the money path no longer does is
       worse than one benefit fewer. */
  ]

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-(--radius-card) border bg-surface p-5 transition-shadow',
        held
          ? 'border-success-500/35 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]'
          : recommended
            ? 'border-violet-600/40 shadow-[0_1px_2px_0_rgb(15_23_42/0.06),0_12px_28px_-16px_rgb(124_58_237/0.45)]'
            : 'border-ink-200 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]',
      )}
    >
      {(held || recommended) && (
        <span
          className={cn(
            'absolute -top-2.5 left-5 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold',
            held
              ? 'bg-success-600 text-white'
              : 'bg-violet-600 text-white',
          )}
        >
          {held ? t('card.held') : t('card.popular')}
        </span>
      )}

      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
          {plan.name}
        </h3>
        <div className="text-right">
          <p className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">{price}</p>
          <p className="text-[0.6875rem] text-ink-500">{t('card.period', { months: 3 })}</p>
        </div>
      </div>

      {plan.description && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">{plan.description}</p>
      )}

      <ul className="mt-4 flex flex-1 flex-col gap-2">
        {benefits.map(({ icon: Icon, text, hint }) => (
          <li key={text} className="flex items-start gap-2.5">
            <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
              <Icon aria-hidden className="size-3" />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.8125rem] leading-relaxed text-ink-700">{text}</span>
              {hint && (
                <span className="block text-[0.75rem] leading-snug text-ink-400">{hint}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* EVERY plan gets the primary button, not just the popular one.
          Operator, 2026-07-31: a blue button on one card and grey ones beside
          it read as "this is the only plan you can actually buy" — which is
          the opposite of the point, since plans stack and any of them can be
          added. The "Popular" tag already tells that story, and it is the only
          thing that should. */}
      {held && endsAt ? (
        <p className="mt-4 rounded-(--radius-input) bg-success-50 px-3 py-2 text-center text-[0.75rem] font-medium text-success-700">
          {t('card.endsOn', {
            date: format.dateTime(new Date(endsAt), {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }),
          })}
        </p>
      ) : (
        <Button variant="primary" fullWidth className="mt-4" onClick={onChoose}>
          {t('card.choose', { plan: plan.name })}
        </Button>
      )}
    </div>
  )
}
