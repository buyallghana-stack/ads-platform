'use client'

import { useState } from 'react'

import { Gem, Zap } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { Plan } from '@/lib/subscriptions/data'
import { multiplierForAmount, pointsPerAd } from '@/lib/subscriptions/pricing'
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
  baseAdPoints,
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
  /** Points a typical ad is worth before any plan multiplier — the number the
   *  preview is worked out from, read from the ad pool rather than assumed. */
  baseAdPoints: number
  /** Points to one cedi, for turning the preview into money. */
  pointsPerCurrencyUnit: number
  onChoose: (amountMinor: number) => void
}) {
  const t = useTranslations('upgrade')
  const format = useFormatter()

  /*
    THE AMOUNT IS THE PRODUCT NOW. A plan is a band, and what somebody pays
    inside it decides what one ad is worth to them — "we may be in the same
    bronze plan but my points per ad may be worth a few points more than my
    fellow bronze plan holder". So the card carries a slider, and it starts at
    the floor: the cheapest way in is the default, and paying more is a choice
    somebody makes rather than one made for them.
  */
  const [amountMinor, setAmountMinor] = useState(plan.bandMinMinor)
  const flexible = plan.bandMaxMinor > plan.bandMinMinor
  const topOfBand = Math.floor(plan.bandMaxMinor / 100) * 100

  const multiplier = multiplierForAmount(plan, amountMinor)
  const perAdPoints = pointsPerAd(baseAdPoints, multiplier)
  const perAdMoney = perAdPoints / pointsPerCurrencyUnit
  const perDay = perAdMoney * plan.dailyAdCap

  const money = (value: number, digits = 2) =>
    format.number(value, {
      style: 'currency',
      currency: plan.currencyCode,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })

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
  const extraAds = plan.dailyAdCap - previousDailyAdCap

  const benefits = [
    {
      icon: Zap,
      text: t('benefits.ads', { count: plan.dailyAdCap }),
      hint: extraAds > 0 ? t('benefits.adsHint', { extra: extraAds, plan: previousName }) : null,
    },
    {
      icon: Gem,
      text: t('benefits.perAd', { points: format.number(perAdPoints) }),
      hint: t('benefits.perAdHint', { money: money(perAdMoney) }),
    },
    /* "Withdraw from X points" was here until 2026-08-01, when the operator
       made the threshold platform-wide: "no plan should have its own
       withdrawal threshold". A card may only list what buying THIS actually
       changes, and that no longer does. */
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
          <p className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">
            {flexible ? money(amountMinor / 100, 0) : price}
          </p>
          <p className="text-[0.6875rem] text-ink-500">
            {t('card.days', { days: plan.periodDays })}
          </p>
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
      {/* ---- Choose your amount ------------------------------------------
          Only where there is genuinely a range: the top plan is a single
          price, and a slider that cannot move is a control that lies. */}
      {!held && (
        <div className="mt-4 rounded-(--radius-card) border border-ink-200 bg-ink-50/60 p-3.5">
          {flexible && (
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`amount-${plan.id}`} className="text-[0.75rem] font-medium text-ink-600">
              {t('card.chooseAmount')}
            </label>
            <span className="text-[0.9375rem] font-semibold text-ink-900 tabular-nums">
              {money(amountMinor / 100, 0)}
            </span>
          </div>
          )}

          {flexible && (<>
          <input
            id={`amount-${plan.id}`}
            type="range"
            min={plan.bandMinMinor}
            /* Whole cedis, floored. The band really runs to one pesewa under
               the next plan (GHS 139.99), and a slider that ends there both
               labels itself "GHS 140" — the next plan's price — and leaves a
               step the thumb can never land on. */
            max={topOfBand}
            /* Whole cedis. Pesewa-level steps would make the slider fussy on a
               phone and change the answer by fractions nobody can see. */
            step={100}
            value={amountMinor}
            onChange={(e) => setAmountMinor(Number(e.target.value))}
            className="mt-2.5 w-full accent-brand-600"
          />

          <div className="flex justify-between text-[0.6875rem] text-ink-400 tabular-nums">
            <span>{money(plan.bandMinMinor / 100, 0)}</span>
            <span>{money(topOfBand / 100, 0)}</span>
          </div>
          </>)}

          {/* What that amount actually buys — the whole point of the control.
              Points first, because that is what lands in the balance, then
              what those points are worth, because that is what people
              actually compare. */}
          <dl
            className={cn(
              'grid grid-cols-2 gap-2',
              flexible ? 'mt-3 border-t border-ink-200 pt-3' : '',
            )}
          >
            <div>
              <dt className="text-[0.625rem] tracking-[0.04em] text-ink-400 uppercase">
                {t('card.previewPerAd')}
              </dt>
              <dd className="text-[0.9375rem] font-semibold text-ink-900 tabular-nums">
                {format.number(perAdPoints)}
                <span className="ml-1 text-[0.6875rem] font-medium text-ink-500">
                  {t('card.points')}
                </span>
              </dd>
              <dd className="text-[0.6875rem] text-success-700 tabular-nums">{money(perAdMoney)}</dd>
            </div>
            <div>
              <dt className="text-[0.625rem] tracking-[0.04em] text-ink-400 uppercase">
                {t('card.previewPerDay')}
              </dt>
              <dd className="text-[0.9375rem] font-semibold text-ink-900 tabular-nums">
                {money(perDay)}
              </dd>
              <dd className="text-[0.6875rem] text-ink-500">
                {t('card.previewAds', { count: plan.dailyAdCap })}
              </dd>
            </div>
          </dl>
        </div>
      )}

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
        <Button variant="primary" fullWidth className="mt-4" onClick={() => onChoose(amountMinor)}>
          {t('card.choose', { plan: plan.name })}
        </Button>
      )}
    </div>
  )
}
