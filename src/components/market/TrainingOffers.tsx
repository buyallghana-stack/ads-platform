'use client'

import { useState } from 'react'
import { Award, Check, Infinity as InfinityIcon, Layers, Link2, TrendingUp } from 'lucide-react'

import { cn } from '@/lib/cn'
import { cedis } from '@/lib/market/money'
import type { TrainingOffer } from '@/lib/market/data'

/**
 * The Market home, for somebody who has not bought training.
 *
 *   "if no purchase of the training program is made should only display the
 *    pricing there"                              — operator, 2026-08-06
 *   "look at the layout of the stacks and implement that"
 *
 * ---------------------------------------------------------------------------
 * THE STACKS LAYOUT (reference 0571)
 *
 * Four blocks, in this order, and the order is the argument:
 *
 *   1. a headline naming what is unlocked
 *   2. ONE card holding every feature — icon, title, subtitle, check
 *   3. a two-up price selector, the cheaper one lit, a badge on the better deal
 *   4. one full-width CTA, with the small print directly underneath
 *
 * It works because it separates WHAT YOU GET from WHAT IT COSTS. My previous
 * version put two product cards side by side, each repeating the same four
 * benefits — so the shared 90% competed with the 10% that actually differs, and
 * the reader had to diff two lists to find it.
 *
 * Here the features are stated once, and the selector carries the only real
 * difference: one commission level or two.
 *
 * ---------------------------------------------------------------------------
 * NO INCOME CLAIM, ANYWHERE
 *
 * This is the screen where one would most naturally appear, and it is the exact
 * thing that turns a defensible programme into an indefensible one
 * (DECISIONS.md §6). Every line below is a description of what is bought, not a
 * prediction of what is earned.
 */
export function TrainingOffers({
  offers,
  labels,
}: {
  offers: TrainingOffer[]
  labels: {
    headline: string
    sub: string
    soonTitle: string
    soonBody: string
    cta: string
    footnote: string
    best: string
    oneLevel: string
    twoLevels: string
  }
}) {
  /* Defaults to the higher tier, which is what the reference does — it lights
     the yearly plan, not the quarterly one. Not a dark pattern: both prices are
     shown at the same size, and switching is one tap. */
  const [chosen, setChosen] = useState(() =>
    offers.length > 1 ? offers[offers.length - 1]!.product_id : offers[0]?.product_id,
  )

  if (offers.length === 0) {
    return (
      <div className="rounded-(--radius-panel) border border-dashed border-ink-300 bg-surface px-4 py-12 text-center">
        <Layers aria-hidden className="mx-auto size-7 text-ink-400" strokeWidth={1.5} />
        <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{labels.soonTitle}</p>
        <p className="mx-auto mt-1 max-w-sm text-[0.875rem] leading-snug text-ink-600">
          {labels.soonBody}
        </p>
      </div>
    )
  }

  const selected = offers.find((o) => o.product_id === chosen) ?? offers[0]!

  const FEATURES = [
    {
      Icon: Link2,
      title: 'Your own link for every product',
      sub: 'Remembered for 30 days after someone opens it',
    },
    {
      Icon: TrendingUp,
      title: 'Commission on what buyers actually pay',
      sub: 'Paid as soon as the sale is confirmed',
    },
    {
      Icon: InfinityIcon,
      title: 'The course stays yours',
      sub: 'Keep it after the year of promoting ends',
    },
    { Icon: Award, title: 'A certificate', sub: 'Issued when you finish every lesson' },
  ]

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-center text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.03em] text-ink-900">
        {labels.headline}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-center text-[0.9375rem] leading-snug text-ink-600">
        {labels.sub}
      </p>

      {/* One card, every feature. Stated once rather than repeated per plan. */}
      <ul className="mt-6 divide-y divide-ink-200 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
        {FEATURES.map(({ Icon, title, sub }) => (
          <li key={title} className="flex items-center gap-3 px-4 py-3.5">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-jade-50 text-jade-700"
            >
              <Icon className="size-4.5" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-semibold text-ink-900">{title}</span>
              <span className="block text-[0.8125rem] leading-snug text-ink-600">{sub}</span>
            </span>
            <Check aria-hidden className="size-5 shrink-0 text-jade-600" strokeWidth={2.5} />
          </li>
        ))}
      </ul>

      {/* The selector. The ONLY real difference between the two courses is how
          far the commission reaches, so that is what the tiles say. */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {offers.map((offer) => {
          const on = offer.product_id === selected.product_id
          const two = offer.depth >= 2
          return (
            <button
              key={offer.product_id}
              type="button"
              onClick={() => setChosen(offer.product_id)}
              aria-pressed={on}
              className={cn(
                'relative rounded-(--radius-card) border-2 px-4 py-3.5 text-left transition-colors',
                on
                  ? 'border-ink-900 bg-surface'
                  : 'border-transparent bg-ink-50 hover:bg-ink-100',
              )}
            >
              {two && (
                <span className="absolute -top-2.5 right-3 rounded-full bg-jade-600 px-2 py-0.5 text-[0.625rem] font-bold text-white">
                  {labels.best}
                </span>
              )}
              <span
                className={cn(
                  'block text-[0.8125rem] font-medium capitalize',
                  on ? 'text-ink-600' : 'text-ink-500',
                )}
              >
                {offer.level}
              </span>
              <span
                className={cn(
                  'mt-0.5 block text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]',
                  on ? 'text-ink-900' : 'text-ink-500',
                )}
              >
                {cedis(offer.price_minor)}
              </span>
              <span className="mt-0.5 block text-[0.75rem] text-ink-500">
                {two ? labels.twoLevels : labels.oneLevel}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-3.5 text-center text-[0.8125rem] leading-snug text-ink-600">
        {labels.footnote}
      </p>

      <a
        href={`/shop/${selected.slug}`}
        className="mt-4 flex w-full items-center justify-center rounded-full bg-action px-5 py-3.5 text-[0.9375rem] font-semibold text-on-action transition-opacity hover:opacity-90"
      >
        {labels.cta.replace('{level}', selected.level)}
      </a>
    </div>
  )
}
