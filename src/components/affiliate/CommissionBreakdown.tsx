import {
  ArrowDownLeft,
  Gamepad2,
  Gift,
  GraduationCap,
  Handshake,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Users,
  Wallet,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { AffiliateBreakdown } from '@/lib/earnings/breakdown'
import { cn } from '@/lib/cn'

/**
 * Where an affiliate's commission came from.
 *
 * ── NOT A TRANSLATION OF THE ADS PAGE ──
 *
 * D27: the two businesses share no table and no function, and they should not
 * share a screen either. What is missing here is as deliberate as what is
 * present. There are no ads, no surveys, no articles, no signup or activation
 * bonuses, and above all no points: commission has been cedis since the first
 * row of the ledger.
 *
 * Two things exist here that have no equivalent on the ads side:
 *
 *   TWO LEVELS. What somebody earned selling, and what they earned because a
 *   person they recruited sold. Affiliates always ask which is which, and the
 *   answer decides whether they recruit or sell next.
 *
 *   CLAWBACKS. A refunded sale reverses its commission, so an affiliate can be
 *   paid and then unpaid. It gets its own line rather than quietly shrinking
 *   the sales figure, because "my commission went down" is a support
 *   conversation this page should end before it starts.
 *
 * Training spend sits apart from earnings for the same reason plan spend does
 * on the ads side, and the note says what training actually buys.
 */
export function CommissionBreakdown({ data }: { data: AffiliateBreakdown }) {
  const t = useTranslations('commissionBreakdown')
  const format = useFormatter()

  const money = (value: number) =>
    format.number(value, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })

  const find = (key: string) => data.sources.find((s) => s.key === key)?.cedis ?? 0
  const adjustments = find('adjustments')

  const rows = [
    { key: 'salesL1', Icon: Handshake, cedis: find('salesL1'), always: true },
    { key: 'salesL2', Icon: Users, cedis: find('salesL2'), always: true },
    { key: 'games', Icon: Gamepad2, cedis: find('games'), always: false },
    { key: 'tasks', Icon: Target, cedis: find('tasks'), always: false },
    { key: 'giftCodes', Icon: Gift, cedis: find('giftCodes'), always: false },
    { key: 'adjustments', Icon: SlidersHorizontal, cedis: adjustments, always: false },
  ].filter((r) => r.always || r.cedis !== 0)

  const nothingYet = data.earned === 0 && data.trainingSpent === 0

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 md:py-7">
      <header className="animate-rise">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      <section
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise mt-5 rounded-(--radius-panel) border border-ink-200 bg-surface p-5"
      >
        <p className="text-[0.75rem] font-medium tracking-[0.08em] text-ink-500 uppercase">
          {t('earnedLabel')}
        </p>
        <p className="mt-1 text-[2rem] leading-none font-bold tracking-[-0.02em] tabular-nums text-ink-900">
          {money(data.earned)}
        </p>

        {/* What the money was made of, in plain counts. An affiliate reads
            their own performance in sales and recruits before cedis. */}
        <p className="mt-1.5 text-[0.75rem] text-ink-500">
          {t('made', { sales: data.salesCount, recruits: data.recruitsCount })}
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Figure label={t('balanceNow')} value={money(data.balance)} tone="brand" />
          <Figure label={t('paidOut')} value={money(data.paidOutNet)} />
          <Figure label={t('clearing')} value={money(data.pending)} />
        </dl>
      </section>

      {nothingYet ? (
        <p className="animate-rise mt-5 rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.875rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <>
          <Section title={t('sourcesTitle')} delay="0.1s">
            <ul className="divide-y divide-ink-100">
              {rows.map((row) => (
                <li key={row.key} className="py-3 first:pt-0 last:pb-0">
                  <Row Icon={row.Icon} label={t(`source.${row.key}`)} value={money(row.cedis)} />
                </li>
              ))}
            </ul>

            {/* Only when it has happened. A clawback line on an account that
                has never had one teaches nothing and worries everybody. */}
            {data.reversed !== 0 && (
              <div className="mt-3 rounded-(--radius-card) border border-warning-500/25 bg-warning-50 px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <RotateCcw aria-hidden className="size-4 shrink-0 text-warning-600" />
                  <span className="min-w-0 flex-1 text-[0.8125rem] font-medium text-warning-700">
                    {t('source.reversed')}
                  </span>
                  <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums text-warning-700">
                    {money(data.reversed)}
                  </span>
                </div>
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-warning-700/90">
                  {t('reversedNote')}
                </p>
              </div>
            )}
          </Section>

          <Section title={t('outTitle')} delay="0.15s">
            <ul className="divide-y divide-ink-100">
              <li className="py-3 first:pt-0">
                <Row Icon={ArrowDownLeft} label={t('out.paid')} value={money(data.paidOutNet)} />
              </li>
              {data.fees > 0 && (
                <li className="py-3">
                  <Row
                    Icon={SlidersHorizontal}
                    label={t('out.fees')}
                    value={money(data.fees)}
                    muted
                  />
                </li>
              )}
              <li className="py-3">
                <Row Icon={Wallet} label={t('out.pending')} value={money(data.pendingOut)} muted />
              </li>
              {data.rejectedOut > 0 && (
                <li className="py-3 last:pb-0">
                  <Row
                    Icon={ArrowDownLeft}
                    label={t('out.rejected')}
                    value={money(data.rejectedOut)}
                    muted
                  />
                </li>
              )}
            </ul>
            <p className="mt-3 border-t border-ink-100 pt-3 text-[0.75rem] leading-relaxed text-ink-500">
              {t('reconcile', {
                earned: money(data.earned),
                out: money(data.paidOut + data.pendingOut),
                balance: money(data.balance),
              })}
            </p>
          </Section>

          <Section title={t('trainingTitle')} delay="0.2s">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[1.375rem] font-semibold tabular-nums text-ink-900">
                {money(data.trainingSpent)}
              </p>
              <p className="text-[0.8125rem] text-ink-500">
                {t('trainingCount', { count: data.trainingCount })}
              </p>
            </div>
            <p className="mt-2 flex items-start gap-2 text-[0.75rem] leading-relaxed text-ink-500">
              <GraduationCap aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{t('trainingNote')}</span>
            </p>
          </Section>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  delay,
  children,
}: {
  title: string
  delay: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{ '--rise-delay': delay } as React.CSSProperties}
      className="animate-rise mt-5 rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5"
    >
      <h2 className="mb-3 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'brand' }) {
  return (
    <div className="rounded-(--radius-input) bg-ink-50 px-2.5 py-2 text-center">
      <dt className="text-[0.6875rem] leading-tight text-ink-500">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[0.9375rem] font-semibold tracking-[-0.01em] tabular-nums',
          /* The affiliate business wears violet, the ads business wears blue.
             Same component shape, different skin, per the mode split. */
          tone === 'brand' ? 'text-brand-700' : 'text-ink-900',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function Row({
  Icon,
  label,
  value,
  muted,
}: {
  Icon: typeof Wallet
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center rounded-full',
          muted ? 'size-5 text-ink-400' : 'size-7 bg-brand-500/10 text-brand-600',
        )}
      >
        <Icon className={muted ? 'size-3.5' : 'size-4'} strokeWidth={muted ? 2 : 2.2} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          muted ? 'text-[0.8125rem] text-ink-500' : 'text-[0.875rem] font-medium text-ink-900',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'shrink-0 tabular-nums',
          muted
            ? 'text-[0.8125rem] text-ink-500'
            : 'text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900',
        )}
      >
        {value}
      </span>
    </div>
  )
}
