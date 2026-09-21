import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'

import { Avatar } from '@/components/profile/Avatar'
import { Link } from '@/i18n/navigation'
import type { AdminLeaderboardRow } from '@/lib/admin/data/leaderboard'
import { cn } from '@/lib/cn'
import { LEADERBOARD_PERIODS, type LeaderboardPeriod, type Movement } from '@/lib/leaderboard/types'

/**
 * The admin leaderboard.
 *
 * The operator asked for "the same ranking table shown to users" with phone,
 * email and full name revealed. So the ranks, points and arrows are the same
 * values from the same function — this is not a second calculation that could
 * disagree with what a user is looking at while they are on the phone about it.
 *
 * NOTHING IS MASKED HERE. That is deliberate and it is the opposite of the
 * payout queue, where destinations are masked at render: a payout screen is
 * about approving a transfer and the full MSISDN is a liability on screen,
 * whereas this screen exists precisely to answer "who is this person at the
 * top of my leaderboard" — masking it would remove the only reason to open it.
 *
 * Table from lg, cards below, like every other admin table in this app.
 */

const MOVEMENT_ICON: Record<Movement, React.ComponentType<{ className?: string }>> = {
  up: TrendingUp,
  down: TrendingDown,
  same: Minus,
  new: Minus,
}

const MOVEMENT_TONE: Record<Movement, string> = {
  up: 'text-success-600',
  down: 'text-danger-600',
  same: 'text-ink-300',
  new: 'text-ink-300',
}

export async function AdminLeaderboard({
  rows,
  period,
}: {
  rows: AdminLeaderboardRow[]
  period: LeaderboardPeriod
}) {
  const t = await getTranslations('admin.leaderboard')
  const tp = await getTranslations('leaderboard.tabs')
  const format = await getFormatter()

  const movementLabel = (row: AdminLeaderboardRow) => {
    if (row.movement === 'new') return t('movement.new')
    if (row.movement === 'same') return t('movement.same')
    const places = row.previousRank === null ? 0 : Math.abs(row.previousRank - row.rank)
    return t(row.movement === 'up' ? 'movement.up' : 'movement.down', { places })
  }

  return (
    <>
      {/* Period tabs. Links, not buttons — the period is in the URL so the
          operator can send somebody "look at last month". */}
      <nav aria-label={tp('label')} className="mb-4 flex flex-wrap gap-1 rounded-(--radius-input) bg-ink-100 p-1">
        {LEADERBOARD_PERIODS.map((key) => (
          <Link
            key={key}
            href={`/admin/leaderboard?period=${key}`}
            aria-current={key === period ? 'page' : undefined}
            className={cn(
              'flex-1 rounded-[calc(var(--radius-input)-0.25rem)] px-3 py-2 text-center',
              'text-[0.8125rem] font-semibold transition-colors',
              key === period
                ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                : 'text-ink-500 hover:text-ink-700',
            )}
          >
            {tp(key)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-(--radius-panel) border border-dashed border-ink-200 px-6 py-12 text-center text-[0.875rem] text-ink-500">
          {t('empty')}
        </p>
      ) : (
        <>
          {/* ---- Table, lg and up --------------------------------------- */}
          <div className="hidden overflow-x-auto rounded-(--radius-panel) border border-ink-200 bg-surface lg:block">
            <table className="w-full min-w-[52rem] text-left text-[0.8125rem]">
              <thead className="border-b border-ink-200 bg-ink-50 text-[0.75rem] uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('col.rank')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('col.person')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('col.email')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('col.phone')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('col.shownAs')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{t('col.points')}</th>
                  <th scope="col" className="px-4 py-3 text-center font-semibold">{t('col.change')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const Icon = MOVEMENT_ICON[row.movement]
                  return (
                    <tr key={row.userId} className="border-b border-ink-100 last:border-b-0">
                      <td className="px-4 py-3 font-bold tabular-nums text-ink-500">{row.rank}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar
                            name={row.fullName}
                            className="size-8 text-[0.625rem]"
                          />
                          <span className="font-semibold text-ink-900">{row.fullName}</span>
                          {row.flagged && (
                            <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-danger-700">
                              {t('flagged')}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-600">{row.email}</td>
                      <td className="px-4 py-3 tabular-nums text-ink-600">{row.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-400">{row.displayName}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink-900">
                        {format.number(row.points)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('flex items-center justify-center gap-1', MOVEMENT_TONE[row.movement])}>
                          <Icon aria-hidden className="size-4" />
                          <span className="text-[0.75rem] font-medium">{movementLabel(row)}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Cards, below lg ---------------------------------------- */}
          <ol className="space-y-2 lg:hidden">
            {rows.map((row) => {
              const Icon = MOVEMENT_ICON[row.movement]
              return (
                <li
                  key={row.userId}
                  className="rounded-(--radius-panel) border border-ink-200 bg-surface p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-center text-[0.875rem] font-bold tabular-nums text-ink-400">
                      {row.rank}
                    </span>
                    <Avatar name={row.fullName} className="size-9 text-[0.6875rem]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[0.875rem] font-semibold text-ink-900">
                          {row.fullName}
                        </span>
                        {row.flagged && (
                          <span className="shrink-0 rounded-full bg-danger-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-danger-700">
                            {t('flagged')}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[0.75rem] text-ink-500">{row.email}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[0.875rem] font-semibold tabular-nums text-ink-900">
                        {format.number(row.points)}
                      </span>
                      <span className={cn('flex items-center justify-end gap-1', MOVEMENT_TONE[row.movement])}>
                        <Icon aria-hidden className="size-3.5" />
                        <span className="text-[0.6875rem] font-medium">{movementLabel(row)}</span>
                      </span>
                    </span>
                  </div>
                  <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-ink-100 pt-2.5 text-[0.75rem]">
                    <div className="flex gap-1.5">
                      <dt className="text-ink-400">{t('col.phone')}</dt>
                      <dd className="tabular-nums text-ink-700">{row.phone ?? '—'}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-ink-400">{t('col.shownAs')}</dt>
                      <dd className="text-ink-700">{row.displayName}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </>
  )
}
