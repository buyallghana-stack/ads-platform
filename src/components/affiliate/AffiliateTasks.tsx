'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, Check, Trophy } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { claimAffiliateTask } from '@/app/[locale]/(affiliate)/market/tasks/actions'
import type { AffiliateTask } from '@/lib/market/play'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * Affiliate tasks: sell, recruit, play, and place on the board.
 *
 * ── A RANK IS NOT A COUNT ──
 *
 * Three of the four metrics count upwards to a target. `leaderboard_rank`
 * counts DOWN to a place, and 0 means not on the board at all. So the progress
 * bar is only drawn for the counting ones; a rank shows where you actually
 * stand, because "3 of 10" would read as a third of the way there when it
 * means seventh place is not good enough.
 *
 * ── CLAIMED IS FOREVER ──
 *
 * The operator's rule: rewarded once. Somebody who reaches the top ten, claims
 * it, and is then overtaken keeps the reward and does not get another when
 * they climb back. A claimed card says so plainly rather than disappearing,
 * because a task that vanishes reads as a bug in a list somebody is working
 * through.
 */
export function AffiliateTasks({ initial }: { initial: AffiliateTask[] }) {
  const t = useTranslations('affiliate.tasks')

  const [tasks, setTasks] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [won, setWon] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()

  const claim = (taskId: string) =>
    startTransition(async () => {
      const result = await claimAffiliateTask({ taskId })
      if (result.tasks?.length) setTasks(result.tasks)
      if (result.ok) {
        setError(null)
        setWon(result.rewardMinor)
      } else {
        setWon(null)
        setError(result.message)
      }
    })

  const ready = tasks.filter((task) => task.ready)
  const waiting = tasks.filter((task) => !task.ready && !task.claimed)
  const done = tasks.filter((task) => task.claimed)

  return (
    <div className="flex flex-col gap-4">
      {won !== null && (
        <p className="flex items-start gap-2 rounded-(--radius-card) border border-success-500/30 bg-success-50 px-4 py-3 text-[0.8125rem] text-ink-900">
          <Check aria-hidden className="mt-px size-4 shrink-0 text-success-600" />
          {won > 0 ? t('claimed', { amount: cedis(won) }) : t('claimedNoReward')}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 px-4 py-3 text-[0.8125rem] text-ink-900"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-600" />
          {error}
        </p>
      )}

      {ready.length > 0 && (
        <Section title={t('sections.ready', { n: ready.length })}>
          {ready.map((task) => (
            <TaskCard key={task.id} task={task} pending={pending} onClaim={() => claim(task.id)} />
          ))}
        </Section>
      )}

      <Section title={t('sections.working')}>
        {waiting.length === 0 ? (
          <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-8 text-center text-[0.8125rem] text-ink-400">
            {t('nothingWaiting')}
          </p>
        ) : (
          waiting.map((task) => <TaskCard key={task.id} task={task} pending={pending} />)
        )}
      </Section>

      {done.length > 0 && (
        <Section title={t('sections.done')}>
          {done.map((task) => (
            <TaskCard key={task.id} task={task} pending={pending} />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[0.6875rem] font-semibold tracking-[0.05em] text-ink-400 uppercase">
        {title}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function TaskCard({
  task,
  pending,
  onClaim,
}: {
  task: AffiliateTask
  pending: boolean
  onClaim?: () => void
}) {
  const t = useTranslations('affiliate.tasks')
  const isRank = task.metric === 'leaderboard_rank'
  const percent = isRank
    ? 0
    : Math.min(100, task.target === 0 ? 0 : Math.round((task.progress / task.target) * 100))

  return (
    <article
      className={cn(
        'rounded-(--radius-panel) border p-3.5',
        task.claimed ? 'border-ink-200 bg-ink-50' : 'border-ink-200 bg-surface',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-(--radius-card) bg-brand-600/10 text-[1.125rem]"
        >
          {task.icon ?? <Trophy className="size-4 text-brand-700" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[0.875rem] font-semibold text-ink-900">{task.name}</p>
          {task.description && (
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-500">{task.description}</p>
          )}
        </div>

        {task.rewardMinor > 0 && (
          <span className="shrink-0 rounded-full bg-success-500/12 px-2.5 py-1 text-[0.75rem] font-bold whitespace-nowrap tabular-nums text-success-600">
            {cedis(task.rewardMinor)}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {isRank ? (
            <p className="text-[0.75rem] text-ink-500">
              {task.progress === 0
                ? t('rankNone', { target: task.target })
                : t('rankNow', { rank: task.progress, target: task.target })}
            </p>
          ) : (
            <>
              <p className="text-[0.75rem] tabular-nums text-ink-500">
                {t('progress', { progress: Math.min(task.progress, task.target), target: task.target })}
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={cn(
                    'h-full rounded-full',
                    task.claimed ? 'bg-ink-300' : 'bg-success-500',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </>
          )}
        </div>

        {task.claimed ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[0.75rem] font-semibold text-ink-400">
            <Check aria-hidden className="size-3.5" />
            {t('alreadyClaimed')}
          </span>
        ) : onClaim ? (
          <button
            type="button"
            disabled={pending}
            onClick={onClaim}
            className="shrink-0 rounded-(--radius-input) bg-brand-600 px-3.5 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:bg-ink-100 disabled:text-ink-400"
          >
            {t('claim')}
          </button>
        ) : null}
      </div>
    </article>
  )
}
