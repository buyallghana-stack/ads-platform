'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Gem, Minus, Plus, Zap } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { Plan } from '@/lib/subscriptions/data'
import { multiplierForAmount, pointsPerAd } from '@/lib/subscriptions/pricing'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/** Where "don't show me this again" is remembered. */
const NOTICE_KEY = 'sideperks.flexiblePricingNotice'

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
  amountPaidMinor,
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
  amountPaidMinor?: number | null
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
  /* Whether they have actually chosen, as opposed to accepting the floor
     because it was already there. It decides whether "Get Bronze" stops to
     mention that the price is theirs to set. */
  const [touched, setTouched] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [suppressNotice, setSuppressNotice] = useState(false)
  const sliderRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  /*
    A modal has to be reachable and escapable from the keyboard. Opening it
    moves focus into it — otherwise the next Tab carries on through the card
    BEHIND the dimmed screen — and Escape closes it, which is what every
    dialog on the platform does and the only thing somebody will try.
    Escape means "not now": it takes them back to the card without buying,
    and without recording a preference they did not confirm.
  */
  useEffect(() => {
    if (!noticeOpen) return
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNoticeOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [noticeOpen])

  const flexible = plan.bandMaxMinor > plan.bandMinMinor
  const topOfBand = Math.floor(plan.bandMaxMinor / 100) * 100

  /** One tap of the −/+ pair. A cedi at a time would need seventy-four taps to
   *  cross Bronze; five crosses it in fifteen and still lands on every price
   *  the slider can reach. */
  const STEP_MINOR = 500

  const nudge = (by: number) => {
    setTouched(true)
    setAmountMinor((current) =>
      Math.min(Math.max(current + by, plan.bandMinMinor), topOfBand),
    )
  }

  /*
    Read at the moment of the click rather than into state on mount: reading
    localStorage during render is a hydration mismatch, and an effect to work
    around that would run on every card on the screen for a value only one of
    them will ever need. Private-mode Safari throws on access, so the whole
    thing is a try/catch and the fallback is to show the notice — being told
    twice is better than never being told.
  */
  const noticeDismissed = () => {
    try {
      return window.localStorage.getItem(NOTICE_KEY) === 'dismissed'
    } catch {
      return false
    }
  }

  const rememberIfAsked = () => {
    if (!suppressNotice) return
    try {
      window.localStorage.setItem(NOTICE_KEY, 'dismissed')
    } catch {
      // Nothing to do: they simply see it again next time.
    }
  }

  const choose = () => {
    if (flexible && !touched && !noticeDismissed()) {
      setNoticeOpen(true)
      return
    }
    onChoose(amountMinor)
  }

  const effectivePaidMinor = held ? (amountPaidMinor ?? plan.priceMinor) : amountMinor
  const activeMultiplier = multiplierForAmount(plan, effectivePaidMinor)
  const activePerAdPoints = pointsPerAd(baseAdPoints, activeMultiplier)
  const activePerAdMoney = activePerAdPoints / pointsPerCurrencyUnit
  const activePerDay = activePerAdMoney * plan.dailyAdCap

  const multiplier = multiplierForAmount(plan, amountMinor)
  const perAdPoints = pointsPerAd(baseAdPoints, multiplier)
  const perAdMoney = perAdPoints / pointsPerCurrencyUnit
  const perDay = perAdMoney * plan.dailyAdCap

  const displayPerAdPoints = held ? activePerAdPoints : perAdPoints
  const displayPerAdMoney = held ? activePerAdMoney : perAdMoney

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
    The benefits never state the multiplier. It is an abstraction, and since
    2026-08-04 it is not even a fixed property of the plan — it moves with the
    amount. What the list carries instead is the worked figure for the amount
    currently chosen ("150 pts an ad"), which is the same fact in a form
    somebody can check against the ad they just watched.
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
      text: t('benefits.perAd', { points: format.number(displayPerAdPoints) }),
      hint: t('benefits.perAdHint', { money: money(displayPerAdMoney) }),
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
          {/* The RANGE, not a single figure: the price is the thing the
              buyer chooses, and a card headed "GHS 65" reads as a fixed one.
              What they have actually chosen sits in the panel below, where
              they are choosing it. */}
          <p className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">
            {flexible
              ? `${money(plan.bandMinMinor / 100, 0)} – ${money(topOfBand / 100, 0).replace(/^[^\d]+/, '')}`
              : price}
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

      {/* ---- Choose your amount ------------------------------------------
          Only where there is genuinely a range: the top plan is a single
          price, and a slider that cannot move is a control that lies. */}
      {!held && (
        <div
          className={cn(
            'mt-4 rounded-(--radius-card) p-3.5',
            /* Brand-bordered where the price is actually chosen, so the
               control reads as the point of the card rather than as small
               print under it. A plain grey panel was being scrolled past. */
            flexible
              ? 'border-2 border-brand-600/40 bg-brand-50/40 shadow-[0_0_0_3px] shadow-brand-600/5'
              : 'border border-ink-200 bg-ink-50/60',
          )}
        >
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
          <div className="mt-2.5 flex items-center gap-2">
            {/* The buttons are not decoration. A range input is awkward with a
                thumb on a small screen, harder with a tremor, and unusable
                with some assistive setups — and this control is now the price
                of the product, so it cannot have only one way in. */}
            <button
              type="button"
              onClick={() => nudge(-STEP_MINOR)}
              disabled={amountMinor <= plan.bandMinMinor}
              aria-label={t('card.less', { step: money(STEP_MINOR / 100, 0) })}
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full border transition-colors',
                'border-brand-600/30 bg-surface text-brand-700',
                'hover:border-brand-600 hover:bg-brand-50',
                'disabled:border-ink-200 disabled:text-ink-300 disabled:hover:bg-surface',
                'focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:outline-none',
              )}
            >
              <Minus aria-hidden className="size-4" />
            </button>

            <input
              ref={sliderRef}
              id={`amount-${plan.id}`}
              type="range"
              min={plan.bandMinMinor}
              /* Whole cedis, floored. The band really runs to one pesewa under
                 the next plan (GHS 139.99), and a slider that ends there both
                 labels itself "GHS 140" — the next plan's price — and leaves a
                 step the thumb can never land on. */
              max={topOfBand}
              step={100}
              value={amountMinor}
              onChange={(e) => {
                setTouched(true)
                setAmountMinor(Number(e.target.value))
              }}
              className="min-w-0 flex-1 accent-brand-600"
            />

            <button
              type="button"
              onClick={() => nudge(STEP_MINOR)}
              disabled={amountMinor >= topOfBand}
              aria-label={t('card.more', { step: money(STEP_MINOR / 100, 0) })}
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full border transition-colors',
                'border-brand-600/30 bg-surface text-brand-700',
                'hover:border-brand-600 hover:bg-brand-50',
                'disabled:border-ink-200 disabled:text-ink-300 disabled:hover:bg-surface',
                'focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:outline-none',
              )}
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>

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

      {held ? (
        <div className="mt-4 rounded-(--radius-card) border border-success-500/30 bg-success-50/60 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.75rem] font-medium text-success-800">
              {t('card.amountPaid')}
            </span>
            <span className="text-[0.9375rem] font-bold text-success-900 tabular-nums">
              {money(effectivePaidMinor / 100, 2)}
            </span>
          </div>

          <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-success-500/20 pt-2.5">
            <div>
              <dt className="text-[0.625rem] font-semibold tracking-[0.04em] text-success-700 uppercase">
                {t('card.adValue')}
              </dt>
              <dd className="text-[0.9375rem] font-bold text-success-900 tabular-nums">
                {money(activePerAdMoney)}
              </dd>
              <dd className="text-[0.6875rem] font-medium text-success-700 tabular-nums">
                {format.number(activePerAdPoints)} {t('card.points')}
              </dd>
            </div>
            <div>
              <dt className="text-[0.625rem] font-semibold tracking-[0.04em] text-success-700 uppercase">
                {t('card.previewPerDay')}
              </dt>
              <dd className="text-[0.9375rem] font-bold text-success-900 tabular-nums">
                {money(activePerDay)}
              </dd>
              <dd className="text-[0.6875rem] text-success-700">
                {t('card.previewAds', { count: plan.dailyAdCap })}
              </dd>
            </div>
          </dl>

          {endsAt && (
            <p className="mt-2.5 border-t border-success-500/20 pt-2 text-center text-[0.75rem] font-medium text-success-800">
              {t('card.endsOn', {
                date: format.dateTime(new Date(endsAt), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }),
              })}
            </p>
          )}
        </div>
      ) : (
        <Button variant="primary" fullWidth className="mt-4" onClick={choose}>
          {t('card.choose', { plan: plan.name })}
        </Button>
      )}

      {/* ---- "You can choose what to pay" --------------------------------
          Shown when somebody reaches for the button without having moved the
          amount at all — because the floor is pre-selected, and a price that
          was already sitting there does not read as a choice. It is not shown
          again once they have adjusted anything, and never again at all if
          they ask. */}
      {/*
        PORTALLED TO THE BODY, and it has to be. This card sits inside the
        plans grid, which carries `animate-rise` — and an ancestor with a
        transform becomes the containing block for `position: fixed`, so a
        "full-screen" overlay rendered here would be centred inside the grid
        instead of the viewport: a dimmed screen with the dialog somewhere
        below the fold. The same trap once left the admin nav drawer 56px
        tall. Playwright still finds it either way, which is why the
        verification script now measures where it actually lands.
      */}
      {noticeOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`flexible-${plan.id}`}
            tabIndex={-1}
            className="w-full max-w-[26rem] rounded-(--radius-panel) bg-surface p-5 shadow-[0_16px_48px_-12px_rgb(15_23_42/0.5)] focus:outline-none"
          >
            <h2
              id={`flexible-${plan.id}`}
              className="text-[1.0625rem] font-semibold text-ink-900"
            >
              {t('flexible.title')}
            </h2>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-500">
              {t('flexible.body', {
                plan: plan.name,
                from: money(plan.bandMinMinor / 100, 0),
                to: money(topOfBand / 100, 0),
              })}
            </p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-500">
              {t('flexible.same', { ads: plan.dailyAdCap })}
            </p>

            <label className="mt-4 flex items-start gap-2.5 text-[0.8125rem] text-ink-600">
              <input
                type="checkbox"
                checked={suppressNotice}
                onChange={(e) => setSuppressNotice(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-brand-600"
              />
              {t('flexible.dontShow')}
            </label>

            <div className="mt-4 flex flex-col gap-2">
              <Button
                fullWidth
                onClick={() => {
                  rememberIfAsked()
                  setNoticeOpen(false)
                  /* Straight to the control, and focused: "set my own amount"
                     that leaves somebody hunting for the slider they could not
                     see in the first place has helped nobody. */
                  sliderRef.current?.focus()
                  sliderRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }}
              >
                {t('flexible.adjust')}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  rememberIfAsked()
                  setNoticeOpen(false)
                  onChoose(amountMinor)
                }}
              >
                {t('flexible.continue', { amount: money(amountMinor / 100, 0) })}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
