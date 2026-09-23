'use client'

import type { ReactNode } from 'react'

import { ArrowRight, Check } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import type { UpgradePitch } from '@/lib/onboarding/data'

/**
 * The three moments worth the whole screen: the welcome, the congratulation
 * and the offer.
 *
 * ⚠️ NO SCRIM. THESE ARE SCREENS, NOT CARDS ON FOG. The first build floated a
 * white panel on a grey wash, which is the default dialog look every framework
 * ships with, and it reads as something bolted onto the app interrupting it.
 * There is nothing behind these three worth peering at through a haze: the
 * welcome has an empty dashboard behind it, the congratulation has the ad that
 * just finished, and the offer comes after the whole tour. So each one OWNS
 * the viewport, with its own field of colour, its own vertical rhythm, and its
 * action pinned to the bottom edge where a thumb already is.
 *
 * A full field can carry a feeling. A 420px card on 55% black cannot, and that
 * is the whole difference between a reward screen and an error dialog.
 */

function Screen({
  children,
  label,
  background,
}: {
  children: ReactNode
  label: string
  /** The field. A full-bleed colour, never a wash over the app behind it. */
  background: string
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-100 flex flex-col overflow-y-auto"
      style={{ background }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)]">
        {children}
      </div>
    </div>
  )
}

/** The action area, pushed to the bottom of the field by the spacer above it. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col gap-2 pt-8">{children}</div>
}

/*
  ⚠️ `bg-...` UNDER THE GRADIENT IN EVERY FIELD BELOW, and it is load-bearing.
  A Tailwind v4 gradient is assembled from `@property` variables that Safari
  did not ship until 16.4, and an iPhone 7 stops at 15.6. There the gradient
  paints nothing at all, and white text would land on white. These are written
  as plain CSS with a flat colour behind them for exactly that reason, the same
  way the dashboard hero is.
*/
const FIELD_BRAND = 'linear-gradient(160deg, #0068f8 0%, #0043a3 62%, #00245c 100%), #0068f8'
const FIELD_SUCCESS = 'linear-gradient(160deg, #047857 0%, #065f46 55%, #022c22 100%), #047857'
const FIELD_INK = 'linear-gradient(160deg, #0f172a 0%, #0b1626 60%, #020617 100%), #0f172a'

/** On a coloured field, the primary button inverts or it disappears into it. */
const ON_FIELD =
  'border-white bg-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.6),0_8px_24px_-8px_rgb(0_0_0/0.45)] hover:border-white hover:bg-white'
const QUIET_ON_FIELD = 'text-white/65 hover:bg-white/10 hover:text-white'

/* ------------------------------------------------------------------------ */

/** Shown once, on the first Home load after signing up. */
export function WelcomeSheet({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const t = useTranslations('onboarding.welcome')

  return (
    <Screen label={t('title')} background={FIELD_BRAND}>
      <Logo className="h-7 w-auto text-white" />

      <div className="mt-10">
        <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] text-white">
          {t('title')}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-white/75">{t('body')}</p>
      </div>

      <ul className="mt-9 flex flex-col gap-5">
        {(['watch', 'earn', 'withdraw'] as const).map((key, i) => (
          <li key={key} className="flex items-start gap-4">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-[0.8125rem] font-bold text-white"
            >
              {i + 1}
            </span>
            <p className="pt-1 text-[0.9375rem] leading-relaxed text-white/85">
              {t(`points.${key}`)}
            </p>
          </li>
        ))}
      </ul>

      <Actions>
        <Button
          size="lg"
          fullWidth
          onClick={onStart}
          trailingIcon={<ArrowRight />}
          className={`${ON_FIELD} text-brand-700 hover:text-brand-800 active:bg-brand-50`}
        >
          {t('cta')}
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={onSkip} className={QUIET_ON_FIELD}>
          {t('skip')}
        </Button>
      </Actions>
    </Screen>
  )
}

/**
 * The congratulation, with the real number.
 *
 * `points` is what the ledger actually credited, not what the tier says an ad
 * should pay. They are the same number today; on the day they are not, the one
 * the member watched land is the only one that can be repeated back to them.
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
    <Screen label={t('title')} background={FIELD_SUCCESS}>
      <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
        <span aria-hidden className="grid size-16 place-items-center rounded-full bg-white/15 text-white">
          <Check className="size-8" strokeWidth={3} />
        </span>

        <p className="mt-7 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-white/70">
          {t('eyebrow')}
        </p>
        <p className="mt-2 text-[3.5rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-white">
          {format.number(cedis, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })}
        </p>
        <p className="mt-2 text-[1rem] font-medium text-white/70">{t('points', { points })}</p>

        <h1 className="mt-10 text-[1.375rem] font-bold leading-tight tracking-[-0.01em] text-white">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-[22rem] text-[0.9375rem] leading-relaxed text-white/75">
          {t('body')}
        </p>
      </div>

      <Actions>
        <Button
          size="lg"
          fullWidth
          onClick={onNext}
          trailingIcon={<ArrowRight />}
          className={`${ON_FIELD} text-success-700 hover:text-success-700 active:bg-success-50`}
        >
          {t('cta')}
        </Button>
      </Actions>
    </Screen>
  )
}

/**
 * The offer.
 *
 * ⚠️ IT IS THE LAST STEP (operator, 2026-09-23). It used to sit fourth, right
 * behind the congratulation, on the argument that the moment of the first cedi
 * is the moment of most willingness. The operator's call is that the plans are
 * shown once the member has seen the whole product, and that is what ships.
 *
 * ⚠️ EVERY FIGURE IS READ LIVE FROM THE LADDER, and the qualifying sentence is
 * not optional: the term total is what the plan pays IF they watch every ad
 * every day. Printing it without that line is a promise the product does not
 * make, and the first member who watches half of them is a refund request with
 * a screenshot attached.
 *
 * ⚠️ THE CTA FINISHES THE STEP BEFORE IT NAVIGATES. It was a plain link to
 * /upgrade, and the driver, still holding `upgrade` as the current step, threw
 * the member straight back. The plans were unreachable and the button looked
 * dead. Anything here that leaves the walkthrough has to end the step on its
 * way out.
 */
export function UpgradeSheet({
  pitch,
  onAccept,
  onDecline,
}: {
  pitch: UpgradePitch
  onAccept: () => void
  onDecline: () => void
}) {
  const t = useTranslations('onboarding.upgrade')
  const format = useFormatter()
  const money = (n: number) =>
    format.number(n, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })
  /* Plan prices are whole cedis on every rung of the ladder, and "GHS 85.00"
     wrapped the plan name onto a second line at 360px. Decimals that are
     always .00 buy nothing and cost a line. */
  const price = (n: number) =>
    format.number(n, {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    })

  return (
    <Screen label={t('title')} background={FIELD_INK}>
      <div className="pt-4">
        <p className="text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-brand-400">
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-[1.75rem] font-bold leading-[1.15] tracking-[-0.02em] text-white">
          {t('title')}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-white/70">
          {t('lead', { cap: pitch.dailyAdCap, plan: pitch.name })}
        </p>
      </div>

      {/* The comparison is the argument: two rows, one shape, so the only
          thing that moves between them is the number. */}
      <div className="mt-8 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-4 rounded-(--radius-card) border border-white/10 bg-white/5 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-[0.875rem] font-semibold text-white/70">{t('free.name')}</p>
            <p className="mt-0.5 text-[0.8125rem] text-white/45">
              {t('free.detail', { days: pitch.freeDays })}
            </p>
          </div>
          <p className="shrink-0 text-right">
            <span className="block text-[1rem] font-bold tabular-nums text-white/70">
              {money(pitch.freeDailyGhs)}
            </span>
            <span className="block text-[0.75rem] text-white/40">{t('perDay')}</span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-(--radius-card) border border-brand-400/50 bg-brand-600/20 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-[0.875rem] font-semibold text-white">
              {t('plan.name', { plan: pitch.name, price: price(pitch.priceGhs) })}
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-white/60">
              {t('plan.detail', { cap: pitch.dailyAdCap, days: pitch.termDays })}
            </p>
          </div>
          <p className="shrink-0 text-right">
            <span className="block text-[1.25rem] font-bold tabular-nums text-brand-400">
              {money(pitch.dailyGhs)}
            </span>
            <span className="block text-[0.75rem] text-white/50">{t('perDay')}</span>
          </p>
        </div>
      </div>

      <p className="mt-6 text-[0.9375rem] leading-relaxed text-white/85">
        {t('total', {
          price: price(pitch.priceGhs),
          days: pitch.termDays,
          total: money(pitch.termGhs),
        })}
      </p>
      <p className="mt-2 text-[0.75rem] leading-relaxed text-white/45">{t('caveat')}</p>

      <Actions>
        <Button size="lg" fullWidth onClick={onAccept} trailingIcon={<ArrowRight />}>
          {t('cta', { plan: pitch.name, price: price(pitch.priceGhs) })}
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={onDecline} className={QUIET_ON_FIELD}>
          {t('decline')}
        </Button>
      </Actions>
    </Screen>
  )
}
