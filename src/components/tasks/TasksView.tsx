'use client'

import { useState, useTransition } from 'react'

import { Check, Coins } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { claimTask } from '@/app/[locale]/(app)/tasks/actions'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { isOneShot, type UserTask } from '@/lib/tasks/types'

/**
 * Tasks.
 *
 * The genre's one real device is the progress bar, so the screen is built
 * around it: a bar that fills, and a tick when there is nothing to fill —
 * because a task with a target of 1 ("set a withdrawal PIN") has no progress
 * to show and a bar stuck at 0% or 100% says less than a checkbox does.
 * Nothing in the data marks which sort a task is; `target <= 1` is the whole
 * distinction.
 *
 * The database orders the list so anything ready to claim comes first. That
 * is the only row on this screen that asks the user to do something, and it
 * should not be below the fold on a phone.
 *
 * A claimed task stays visible, greyed, with its tick. Removing it would hide
 * the evidence of what somebody achieved, which is most of why these screens
 * work at all.
 */

/* The icon is an EMOJI the operator typed, not a component name. That was the
   operator's call and it is the right one: a fixed icon list means they can
   only describe a task with something I thought of in advance, and there is no
   Lucide glyph for "invite your friends" that reads as well as 🤝 does.
   Anything empty falls back rather than rendering a gap. */
const FALLBACK_EMOJI = '🎯'

export function TasksView({ tasks }: { tasks: UserTask[] }) {
  const t = useTranslations('tasks')
  const format = useFormatter()

  const [rows, setRows] = useState(tasks)
  const [busy, setBusy] = useState<string | null>(null)
  const [won, setWon] = useState<{ name: string; points: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const claimable = rows.filter((r) => r.claimable).length
  const claimed = rows.filter((r) => r.claimedAt !== null).length
  const unclaimedPoints = rows
    .filter((r) => r.claimable)
    .reduce((sum, r) => sum + r.rewardPoints, 0)

  const claim = (task: UserTask) => {
    if (busy) return
    setBusy(task.id)
    setError(null)

    startTransition(async () => {
      const result = await claimTask(task.id)
      setBusy(null)

      if (!result.ok) {
        setError(t(`errors.${result.reason}`))
        return
      }

      setWon({ name: result.name, points: result.points })
      setRows((current) =>
        current.map((r) =>
          r.id === task.id
            ? { ...r, claimable: false, claimedAt: new Date().toISOString() }
            : r,
        ),
      )
      window.setTimeout(() => setWon(null), 3200)
    })
  }

  return (
    <>
      {/* The summary earns its place only when there is something to collect. */}
      {claimable > 0 && (
        <div
          role="status"
          style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
          className="animate-rise mt-5 flex items-center gap-3 rounded-(--radius-panel) border border-success-500/25 bg-success-50 px-4 py-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-500/15 text-success-700">
            <Coins aria-hidden className="size-4.5" />
          </span>
          <p className="text-[0.8125rem] font-semibold text-success-700">
            {t('readyToClaim', { count: claimable, points: format.number(unclaimedPoints) })}
          </p>
        </div>
      )}

      {won && (
        <p
          role="status"
          className="animate-rise mt-4 rounded-(--radius-input) border border-success-500/25 bg-success-50 px-3.5 py-2.5 text-center text-[0.875rem] font-semibold text-success-700"
        >
          {t('claimed', { name: won.name, points: format.number(won.points) })}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-center text-[0.8125rem] text-danger-700"
        >
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-10 rounded-(--radius-panel) border border-dashed border-ink-200 px-6 py-12 text-center text-[0.875rem] text-ink-500">
          {t('empty')}
        </p>
      ) : (
        <ol className="mt-4 space-y-2.5">
          {rows.map((task, index) => {
            const emoji = task.icon?.trim() || FALLBACK_EMOJI
            const done = task.claimedAt !== null
            const oneShot = isOneShot(task)
            const pct = Math.min(100, Math.round((task.progress / Math.max(task.target, 1)) * 100))

            return (
              <li
                key={task.id}
                style={{ '--rise-delay': `${0.08 + Math.min(index, 8) * 0.03}s` } as React.CSSProperties}
                className={cn(
                  'animate-rise rounded-(--radius-panel) border bg-surface p-4 transition-colors',
                  task.claimable
                    ? 'border-success-500/40 shadow-[0_1px_2px_rgb(15_23_42/0.06)]'
                    : 'border-ink-200',
                  done && 'opacity-70',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-full',
                      done
                        ? 'bg-success-50 text-success-600'
                        : task.claimable
                          ? 'bg-success-50 text-success-600'
                          : 'bg-brand-50 text-brand-600',
                    )}
                  >
                    {done ? (
                      <Check aria-hidden className="size-5" strokeWidth={2.5} />
                    ) : (
                      /* aria-hidden: the task's name is right beside it, so a
                         screen reader announcing "party popper" would only
                         add noise. */
                      <span aria-hidden className="text-[1.375rem] leading-none">
                        {emoji}
                      </span>
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h2 className="text-[0.9375rem] font-semibold text-ink-900">{task.name}</h2>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[0.75rem] font-bold tabular-nums',
                          done ? 'bg-ink-100 text-ink-500' : 'bg-success-50 text-success-700',
                        )}
                      >
                        +{format.number(task.rewardPoints)}
                      </span>
                    </div>

                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">
                      {task.description}
                    </p>

                    {/* A bar only where a bar means something. */}
                    {!oneShot && !done && (
                      <div className="mt-2.5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                          <div
                            className={cn(
                              'h-full rounded-full transition-[width] duration-500',
                              task.claimable ? 'bg-success-500' : 'bg-brand-600',
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[0.75rem] tabular-nums text-ink-400">
                          {t('progress', {
                            done: format.number(task.progress),
                            target: format.number(task.target),
                          })}
                        </p>
                      </div>
                    )}

                    {(task.claimable || done) && (
                      <div className="mt-3">
                        {done ? (
                          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-400">
                            <Check aria-hidden className="size-4" />
                            {t('done')}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => claim(task)}
                            loading={busy === task.id}
                            disabled={busy !== null}
                          >
                            {t('claim')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-5 text-center text-[0.75rem] text-ink-400">
        {t('footer', { claimed, total: rows.length })}
      </p>
    </>
  )
}
