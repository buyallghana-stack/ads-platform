import type { Metadata } from 'next'

import { ArrowLeft, ArrowUpRight, Minus, Sparkles, TrendingDown } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { avatarPublicUrl } from '@/lib/profile/avatar'
import {
  getAffiliateLeaderboard,
  getAffiliateStanding,
  type LeaderboardPeriod,
} from '@/lib/market/play'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

export const metadata: Metadata = {
  title: 'Leaderboard',
  robots: { index: false, follow: false },
}

const PERIODS: LeaderboardPeriod[] = ['week', 'month', 'all']

const isPeriod = (v: string | undefined): v is LeaderboardPeriod =>
  PERIODS.includes(v as LeaderboardPeriod)

/**
 * Who is earning the most commission.
 *
 * ── THE SAME BOARD AS THE ADS ONE, IN A DIFFERENT CURRENCY ──
 *
 * Same periods, same movement arrows, same "where you stand" line for somebody
 * outside the visible ranks. What differs is the number: cleared commission in
 * cedis rather than points, which is the operator's whole reason for wanting
 * it (2026-08-07).
 *
 * Reversals count against a total. A clawed-back sale did not happen, and a
 * board that ignored them would rank somebody on money they no longer hold.
 * Payouts do not: withdrawing is not un-earning.
 *
 * ── NO PRIZE ATTACHES TO A PLACE ──
 *
 * Placing here pays nothing by itself. What a rank can do is complete a task,
 * once, which is a different thing and is stated on the Tasks screen. Server
 * rendered: nothing on it is interactive beyond the three period links.
 */
export default async function AffiliateLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { locale } = await params
  const { period: raw } = await searchParams
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.board')
  const period: LeaderboardPeriod = isPeriod(raw) ? raw : 'week'

  const [rows, standing] = await Promise.all([
    getAffiliateLeaderboard(period),
    getAffiliateStanding(user!.id, period),
  ])

  const podium = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <div className="relative isolate mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <Link
        href="/market"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-500">{t('subtitle')}</p>
      </div>

      <nav aria-label={t('periodLabel')} className="flex gap-2">
        {PERIODS.map((key) => (
          <Link
            key={key}
            href={`/market/leaderboard?period=${key}`}
            aria-current={key === period ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors',
              key === period
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300',
            )}
          >
            {t(`period.${key}`)}
          </Link>
        ))}
      </nav>

      {/* Where you stand, above the board rather than buried in it. Somebody in
          140th place is not in the visible ranks, and this line is what they
          came for. */}
      <section
        className={cn(
          'rounded-(--radius-panel) border p-4',
          standing.ranked ? 'border-brand-600/30 bg-brand-50' : 'border-ink-200 bg-surface',
        )}
      >
        {standing.ranked ? (
          <>
            <p className="text-[0.75rem] text-ink-500">{t('you')}</p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[1.5rem] font-bold leading-none tabular-nums text-ink-900">
                {t('place', { rank: standing.rank })}
              </span>
              <span className="text-[0.875rem] font-semibold tabular-nums text-success-600">
                {cedis(standing.amountMinor)}
              </span>
            </p>
          </>
        ) : (
          <p className="text-[0.8125rem] leading-snug text-ink-600">{t('unranked')}</p>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="rounded-(--radius-panel) border border-dashed border-ink-200 px-4 py-14 text-center text-[0.8125rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <>
          {podium.length > 0 && (
            <ol className="flex flex-col gap-2">
              {podium.map((row) => (
                <li key={row.userId}>
                  <Row row={row} me={row.userId === user!.id} big />
                </li>
              ))}
            </ol>
          )}

          {rest.length > 0 && (
            <ol className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
              {rest.map((row) => (
                <li key={row.userId} className="border-t border-ink-200 first:border-t-0">
                  <Row row={row} me={row.userId === user!.id} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

const MOVEMENT = {
  up: { Icon: ArrowUpRight, tone: 'text-success-600' },
  down: { Icon: TrendingDown, tone: 'text-danger-600' },
  same: { Icon: Minus, tone: 'text-ink-300' },
  new: { Icon: Sparkles, tone: 'text-brand-600' },
} as const

function Row({
  row,
  me,
  big,
}: {
  row: Awaited<ReturnType<typeof getAffiliateLeaderboard>>[number]
  me: boolean
  big?: boolean
}) {
  const { Icon, tone } = MOVEMENT[row.movement]
  const avatar = avatarPublicUrl(row.avatarPath)

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3',
        big && 'rounded-(--radius-panel) border border-ink-200 bg-surface py-3.5',
        me && 'bg-brand-50',
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full text-[0.8125rem] font-bold tabular-nums',
          row.rank === 1
            ? 'bg-warning-500/20 text-warning-600'
            : row.rank === 2
              ? 'bg-ink-200 text-ink-700'
              : row.rank === 3
                ? 'bg-orange-500/15 text-orange-600'
                : 'text-ink-400',
        )}
      >
        {row.rank}
      </span>

      {avatar ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={avatar} alt="" className="size-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-100 text-[0.75rem] font-semibold text-ink-500"
        >
          {row.name.slice(0, 1).toUpperCase()}
        </span>
      )}

      <p className={cn('min-w-0 flex-1 truncate text-[0.875rem]', me ? 'font-semibold' : '')}>
        {row.name}
      </p>

      <Icon aria-hidden className={cn('size-4 shrink-0', tone)} />

      <p className="shrink-0 text-[0.875rem] font-semibold whitespace-nowrap tabular-nums text-ink-900">
        {cedis(row.amountMinor)}
      </p>
    </div>
  )
}
