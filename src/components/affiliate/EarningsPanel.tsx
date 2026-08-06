import { ArrowUpRight, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import type { PerformancePoint } from '@/lib/market/data'
import { cn } from '@/lib/cn'

/**
 * The panel at the top of the affiliate dashboard: what has been earned, how
 * that compares, and what can be taken out today.
 *
 * Same anatomy as the ads balance hero — a lit gradient panel, the money as
 * the largest thing on the screen, the actions on it — in the other business's
 * hue. Deliberate: two businesses, one company. What differs is that this one
 * carries TWO figures, and the distinction between them is the single most
 * important thing on the screen.
 *
 *   Total earned    everything credited, ever or in the window
 *   Available       what has cleared the hold and can be withdrawn now
 *
 * They are given different sizes and different surfaces, and Available sits in
 * its own inset card with the button that acts on it, so the number the button
 * applies to is unambiguous. An affiliate reading the big figure and tapping
 * Withdraw expecting that amount is the single most predictable complaint this
 * screen can generate, and layout is the only thing that prevents it.
 */

/** Compact area sparkline of the window. Decoration with a job: it says which
 *  way the headline figure has been moving, which the figure alone cannot. */
function Spark({ series }: { series: PerformancePoint[] }) {
  const values = series.map((d) => d.earned_minor)
  /* Fewer than three non-zero days cannot describe a direction — it draws an
     "L", which reads as a rendering fault rather than as data. The honest
     answer on a new affiliate's first week is to draw nothing. */
  if (values.filter((v) => v > 0).length < 3) return null

  const max = Math.max(...values, 1)
  const w = 160
  const h = 48
  const pts = values.map(
    (v, i) => [(i / (values.length - 1)) * w, h - (v / max) * (h - 6) - 3] as const,
  )
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${w} ${h}`}
      className="h-12 w-40 shrink-0 self-end"
      preserveAspectRatio="none"
    >
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="rgb(255 255 255 / 0.18)" />
      <path
        d={line}
        fill="none"
        stroke="rgb(255 255 255 / 0.9)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export async function EarningsPanel({
  earnedMinor,
  balanceMinor,
  pendingMinor,
  deltaPercent,
  days,
  series,
  payoutsEnabled,
  minimumMinor,
  periodSlot,
}: {
  /** Credited in the window. */
  earnedMinor: number
  /** Cleared and withdrawable right now. */
  balanceMinor: number
  /** Credited but still inside the hold. */
  pendingMinor: number
  /** Against the previous window of the same length. Null when there is no
   *  baseline — see `periodDelta`. */
  deltaPercent: number | null
  days: number
  series: PerformancePoint[]
  payoutsEnabled: boolean
  minimumMinor: number
  /** The period picker, rendered by the page so this stays a server component. */
  periodSlot?: React.ReactNode
}) {
  const t = await getTranslations('affiliate.earnings')
  const up = (deltaPercent ?? 0) >= 0
  const canWithdraw = payoutsEnabled && balanceMinor >= minimumMinor

  return (
    <section
      aria-label={t('panelLabel')}
      className="bg-affiliate-hero relative isolate overflow-hidden rounded-(--radius-panel) px-5 py-5 text-white shadow-[0_1px_2px_rgb(0_0_0/0.3),0_20px_44px_-20px_rgb(76_33_153/0.85)] sm:px-6"
    >
      {/* Two soft pools and a drifting hairline ring — the same texture the ads
          hero and the auth panel use, kept faint. */}
      <div aria-hidden className="absolute -right-16 -top-24 -z-10 size-64 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="absolute -right-8 -top-14 -z-10 size-52 rounded-full border border-white/12" />

      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-white/70">
          {t('totalEarned')}
        </p>
        {periodSlot}
      </div>

      <div className="mt-1 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[2.125rem] font-bold leading-none tracking-[-0.02em] tabular-nums sm:text-[2.5rem]">
            <span className="mr-1.5 align-top text-[1.0625rem] font-semibold leading-[1.9] text-white/80 sm:text-[1.125rem]">
              GHS
            </span>
            {(Math.abs(earnedMinor) / 100).toLocaleString('en-GH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>

          {deltaPercent === null ? (
            <p className="mt-2 text-[0.8125rem] text-white/70">{t('noBaseline', { n: days })}</p>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] tabular-nums">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold',
                  up ? 'bg-white/15 text-emerald-200' : 'bg-white/15 text-rose-200',
                )}
              >
                {up ? (
                  <TrendingUp aria-hidden className="size-3.5" />
                ) : (
                  <TrendingDown aria-hidden className="size-3.5" />
                )}
                {up ? '+' : ''}
                {deltaPercent}%
              </span>
              <span className="text-white/70">{t('vsPrevious', { n: days })}</span>
            </p>
          )}
        </div>

        <Spark series={series} />
      </div>

      {/* Available balance, inset. Its own surface, so the Withdraw button
          cannot be read as acting on the headline figure above it. */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) bg-black/25 px-4 py-3 ring-1 ring-white/10">
        <div>
          <p className="text-[0.75rem] text-white/70">{t('available')}</p>
          <p className="mt-0.5 text-[1.25rem] font-semibold leading-none tabular-nums">
            {cedis(balanceMinor)}
          </p>
          {pendingMinor > 0 && (
            <p className="mt-1.5 text-[0.75rem] text-white/60">
              {t('pending', { amount: cedis(pendingMinor) })}
            </p>
          )}
        </div>

        {canWithdraw ? (
          <Link
            href="/commission"
            className={cn(
              'inline-flex items-center gap-2 rounded-(--radius-input) bg-white px-4 py-2.5',
              'text-[0.875rem] font-semibold text-brand-950 transition-colors hover:bg-white/90',
            )}
          >
            <Wallet aria-hidden className="size-4" />
            {t('withdraw')}
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        ) : (
          /*
            NOT a disabled button. A greyed control says "you cannot do this"
            and stops; these two cases each have a different reason and a
            different next step, and the affiliate needs to know which one they
            are in. Below the minimum is a matter of earning more; payouts
            switched off platform-wide is not something they can act on at all.
          */
          <p className="max-w-[15rem] text-[0.75rem] leading-snug text-white/70">
            {payoutsEnabled
              ? t('belowMinimum', { amount: cedis(minimumMinor) })
              : t('payoutsClosed')}
          </p>
        )}
      </div>
    </section>
  )
}
