'use client'

import { useState, useTransition } from 'react'

import { Check, ChevronDown, Lock, Users } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { claimTask } from '@/app/[locale]/(app)/tasks/actions'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { TeamMilestones as Milestones } from '@/lib/tasks/types'

/**
 * Team milestones, at the top of the Tasks screen.
 *
 * The rungs are tasks, but they cannot be drawn as task cards: a rung's
 * reward is the TOTAL a person holds once they reach it, and a card reading
 * "+300,000" beside "+100,000" would promise money the ladder never pays. So
 * this panel shows what each rung ADDS, and the number the user acts on is
 * the next payout, which is exactly what the next rung puts in their balance.
 *
 * Cedis, not points: the operator set the ladder in cedis, and "GHS 900" is a
 * promise a member can check; "90,000 points" is not.
 *
 * One Claim button for the whole ladder. The database claims every rung the
 * member has reached, lowest first, so there is no order to get wrong.
 */
export function TeamMilestones({ data }: { data: Milestones }) {
  const t = useTranslations('tasks.milestones')
  const te = useTranslations('tasks.errors')
  const format = useFormatter()
  const router = useRouter()

  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const ghs = (points: number) =>
    format.number(points / data.pointsPerUnit, {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: points % data.pointsPerUnit === 0 ? 0 : 2,
    })

  if (data.rungs.length === 0) return null

  const from = data.current?.target ?? 0
  const pct = data.next
    ? Math.min(100, Math.round(((data.teamMembers - from) / Math.max(1, data.next.target - from)) * 100))
    : 100

  const claim = () => {
    if (!data.claimableTaskId || pending) return
    setMessage(null)
    const taskId = data.claimableTaskId
    startTransition(async () => {
      const result = await claimTask(taskId)
      if (!result.ok) {
        setMessage({ ok: false, text: te(result.reason) })
        return
      }
      setMessage({ ok: true, text: t('claimed', { amount: ghs(result.points) }) })
      // The whole ladder moved: re-read it rather than predict it.
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="team-milestones"
      className="animate-rise mt-5 rounded-(--radius-panel) border border-ink-200 bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Users aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="team-milestones" className="text-[0.9375rem] font-semibold text-ink-900">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{t('subtitle')}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        <Stat label={t('members')} value={format.number(data.teamMembers)} />
        <Stat
          label={t('current')}
          value={data.current ? t('membersCount', { count: data.current.target }) : t('none')}
        />
        <Stat label={t('earned')} value={ghs(data.paidPoints)} />
        <Stat
          label={t('nextPayout')}
          value={data.next ? ghs(data.next.payoutPoints) : t('none')}
          tone="success"
        />
      </dl>

      {data.next ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[0.8125rem] text-ink-600">
            {t('toNext', {
              needed: format.number(data.next.needed),
              target: format.number(data.next.target),
              total: ghs(data.next.totalPoints),
            })}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[0.8125rem] font-medium text-success-700">{t('top')}</p>
      )}

      {data.claimablePoints > 0 && data.claimableTaskId && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-input) border border-success-500/25 bg-success-50 px-3.5 py-3"
        >
          <p className="text-[0.875rem] font-semibold text-success-700">
            {t('ready', { amount: ghs(data.claimablePoints) })}
          </p>
          <Button size="sm" onClick={claim} loading={pending} disabled={pending}>
            {t('claim')}
          </Button>
        </div>
      )}

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={cn(
            'mt-3 rounded-(--radius-input) border px-3.5 py-2.5 text-center text-[0.8125rem] font-medium',
            message.ok
              ? 'border-success-500/25 bg-success-50 text-success-700'
              : 'border-danger-500/25 bg-danger-50 text-danger-700',
          )}
        >
          {message.text}
        </p>
      )}

      <Fold label={t('ladder')}>
        <ol className="divide-y divide-ink-100">
          {data.rungs.map((rung) => {
            const claimed = rung.claimedAt !== null
            const reached = data.teamMembers >= rung.target
            return (
              <li key={rung.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full',
                    claimed
                      ? 'bg-success-50 text-success-600'
                      : reached
                        ? 'bg-brand-50 text-brand-600'
                        : 'bg-ink-100 text-ink-400',
                  )}
                >
                  {claimed ? (
                    <Check aria-hidden className="size-4" strokeWidth={2.5} />
                  ) : (
                    <Lock aria-hidden className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-semibold text-ink-900">
                    {t('membersCount', { count: rung.target })}
                  </p>
                  <p className="text-[0.75rem] text-ink-500">
                    {t('rungTotal', { total: ghs(rung.totalPoints) })}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-[0.8125rem] font-bold tabular-nums',
                    claimed ? 'text-ink-400' : 'text-success-700',
                  )}
                >
                  +{ghs(claimed && rung.paidPoints !== null ? rung.paidPoints : rung.stepPoints)}
                </span>
              </li>
            )
          })}
        </ol>
      </Fold>

      {data.history.length > 0 && (
        <Fold label={t('history')}>
          <ul className="divide-y divide-ink-100">
            {data.history.map((row) => (
              <li key={`${row.target}-${row.claimedAt}`} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-semibold text-ink-900">
                    {t('membersCount', { count: row.target })}
                  </p>
                  <p className="text-[0.75rem] text-ink-500">
                    {t('historyLine', {
                      date: format.dateTime(new Date(row.claimedAt), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                      from: ghs(row.previousTotalPoints),
                      to: ghs(row.milestoneTotalPoints),
                    })}
                  </p>
                </div>
                <span className="shrink-0 text-[0.8125rem] font-bold tabular-nums text-success-700">
                  +{ghs(row.paidPoints)}
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="rounded-(--radius-input) bg-ink-50 px-3 py-2.5">
      <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-[1rem] font-bold tabular-nums',
          tone === 'success' ? 'text-success-700' : 'text-ink-900',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function Fold({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group mt-3 border-t border-ink-100 pt-2">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1.5 text-[0.8125rem] font-semibold text-ink-700 [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown aria-hidden className="size-4 text-ink-400 transition-transform group-open:rotate-180" />
      </summary>
      {children}
    </details>
  )
}
