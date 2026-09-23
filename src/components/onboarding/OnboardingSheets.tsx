'use client'

import type { ReactNode } from 'react'

import { ArrowRight, PartyPopper, Sparkles, TrendingUp } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Link } from '@/i18n/navigation'
import type { UpgradePitch } from '@/lib/onboarding/data'

/**
 * The three moments that own the whole screen rather than pointing at part of
 * it: the welcome, the congratulation, and the offer.
 *
 * They are sheets and not spotlights because there is nothing on the page
 * behind them worth seeing. A bubble pointing at a balance of GHS 1.00 would
 * make the moment smaller than it is.
 */

function Sheet({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-100 flex items-end justify-center bg-ink-900/55 p-4 sm:items-center"
    >
      <div className="animate-rise w-full max-w-md overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface shadow-[0_24px_64px_-16px_rgb(15_23_42/0.55)]">
        {children}
      </div>
    </div>
  )
}

/** Shown once, on the first Home load after signing up. */
export function WelcomeSheet({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const t = useTranslations('onboarding.welcome')

  return (
    <Sheet label={t('title')}>
      <div className="flex flex-col items-center gap-4 bg-brand-600 px-6 py-8 text-center text-white">
        <span aria-hidden className="grid size-14 place-items-center rounded-full bg-white/15">
          <Sparkles className="size-7" />
        </span>
        <h2 className="text-[1.375rem] font-bold leading-tight">{t('title')}</h2>
        <p className="text-[0.875rem] leading-relaxed text-white/85">{t('body')}</p>
      </div>

      <div className="px-6 py-5">
        <ul className="flex flex-col gap-3">
          {(['watch', 'earn', 'withdraw'] as const).map((key, i) => (
            <li key={key} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[0.6875rem] font-bold text-brand-700"
              >
                {i + 1}
              </span>
              <p className="text-[0.8125rem] leading-relaxed text-ink-600">{t(`points.${key}`)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-2">
          <Button size="lg" fullWidth onClick={onStart} trailingIcon={<ArrowRight />}>
            {t('cta')}
          </Button>
          <Button variant="ghost" size="sm" fullWidth onClick={onSkip}>
            {t('skip')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/**
 * The congratulation, with the real number.
 *
 * `points` is what the ledger actually credited, not what the tier says an ad
 * should pay. They are the same number today; on the day they are not, the one
 * the member saw land is the only one that can be repeated back to them.
 */
export function Celebration({
  points,
  perCedi = 100,
  onNext,
}: {
  points: number
  perCedi?: number
  onNext: () => void
}) {
  const t = useTranslations('onboarding.celebrate')
  const format = useFormatter()
  const cedis = points / perCedi

  return (
    <Sheet label={t('title')}>
      <div className="flex flex-col items-center gap-3 bg-success-600 px-6 py-8 text-center text-white">
        <span aria-hidden className="grid size-14 place-items-center rounded-full bg-white/15">
          <PartyPopper className="size-7" />
        </span>
        <p className="text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-white/80">
          {t('eyebrow')}
        </p>
        <p className="text-[2.75rem] font-bold leading-none tabular-nums">
          {format.number(cedis, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })}
        </p>
        <p className="text-[0.875rem] text-white/85">{t('points', { points })}</p>
      </div>

      <div className="px-6 py-5">
        <h2 className="text-[1.0625rem] font-bold leading-snug text-ink-900">{t('title')}</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{t('body')}</p>

        <Button
          size="lg"
          fullWidth
          className="mt-5"
          onClick={onNext}
          trailingIcon={<ArrowRight />}
        >
          {t('cta')}
        </Button>
      </div>
    </Sheet>
  )
}

/**
 * The offer, immediately after the congratulation.
 *
 * ⚠️ EVERY FIGURE HERE IS READ LIVE FROM THE LADDER, and the one qualifying
 * sentence is not optional: the term total is what the plan pays IF they watch
 * every ad every day. Printing it without that line is a promise the product
 * does not make, and the first member who watches half of them and does not
 * reach it is a refund request with a screenshot attached.
 */
export function UpgradeSheet({
  pitch,
  onDecline,
}: {
  pitch: UpgradePitch
  onDecline: () => void
}) {
  const t = useTranslations('onboarding.upgrade')
  const format = useFormatter()
  const money = (n: number) =>
    format.number(n, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })

  return (
    <Sheet label={t('title')}>
      <div className="flex flex-col gap-2 bg-ink-900 px-6 py-6 text-white">
        <span aria-hidden className="grid size-11 place-items-center rounded-full bg-white/10">
          <TrendingUp className="size-5" />
        </span>
        <h2 className="mt-1 text-[1.25rem] font-bold leading-tight">{t('title')}</h2>
        <p className="text-[0.8125rem] leading-relaxed text-white/75">
          {t('lead', { cap: pitch.dailyAdCap, plan: pitch.name })}
        </p>
      </div>

      <div className="px-6 py-5">
        {/* The comparison is the argument. Two rows, same shape, so the
            difference is the only thing that moves. */}
        <div className="overflow-hidden rounded-(--radius-card) border border-ink-200">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-semibold text-ink-500">{t('free.name')}</p>
              <p className="mt-0.5 text-[0.75rem] text-ink-400">
                {t('free.detail', { days: pitch.freeDays })}
              </p>
            </div>
            <p className="shrink-0 text-[0.9375rem] font-bold tabular-nums text-ink-500">
              {t('perDay', { amount: money(pitch.freeDailyGhs) })}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 bg-brand-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-semibold text-brand-700">
                {t('plan.name', { plan: pitch.name, price: money(pitch.priceGhs) })}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-ink-500">
                {t('plan.detail', { cap: pitch.dailyAdCap, days: pitch.termDays })}
              </p>
            </div>
            <p className="shrink-0 text-[0.9375rem] font-bold tabular-nums text-brand-700">
              {t('perDay', { amount: money(pitch.dailyGhs) })}
            </p>
          </div>
        </div>

        <p className="mt-3.5 text-[0.8125rem] leading-relaxed text-ink-600">
          {t('total', {
            price: money(pitch.priceGhs),
            days: pitch.termDays,
            total: money(pitch.termGhs),
          })}
        </p>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-400">{t('caveat')}</p>

        <div className="mt-4 flex flex-col gap-2">
          {/* Link wrapping Button, the way the dashboard's own calls to action
              are built, so this CTA is the same object as the buy button on the
              Upgrade screen rather than a look-alike. */}
          <Link href="/upgrade" className="block">
            <Button size="lg" fullWidth trailingIcon={<ArrowRight />}>
              {t('cta', { plan: pitch.name, price: money(pitch.priceGhs) })}
            </Button>
          </Link>
          <Button variant="ghost" size="sm" fullWidth onClick={onDecline}>
            {t('decline')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
