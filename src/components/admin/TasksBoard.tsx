'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { deleteTask, saveTask, type TaskInput } from '@/app/[locale]/admin/(super)/tasks/actions'
import { Button } from '@/components/ui/Button'
import type { AdminTask } from '@/lib/admin/data/tasks'
import { cn } from '@/lib/cn'
import { TASK_METRICS, type TaskMetric } from '@/lib/tasks/types'

/**
 * The task editor.
 *
 * THE FIGURE THAT MATTERS IS THE COST OF SAVING. Tasks are retroactive — the
 * operator's choice — so "watch 100 ads, 1,500 points" is immediately
 * claimable by everybody who has ever watched 100 ads, and saving it can owe
 * thousands at once. `eligible_now` counts exactly those people and the panel
 * multiplies it by the reward, before the save rather than after.
 *
 * Metrics that are their own answer (`has_2fa`, `has_withdrawal_pin`,
 * `account_created`) have no meaningful target, so the target field
 * disappears for them and the value is pinned to 1. Offering a "set your PIN
 * 5 times" box would be offering nonsense.
 */

const ONE_SHOT_METRICS: TaskMetric[] = [
  'account_created',
  'has_2fa',
  'has_withdrawal_pin',
]

/* Quick picks, not a limit. The field takes any emoji the operator's keyboard
   can produce — these are just the ones a rewards platform reaches for most,
   so the common case is one tap rather than hunting through a picker. */
const EMOJI_SUGGESTIONS = [
  '🎉', '📸', '▶️', '🍿', '🗳️', '🔐', '🛡️', '💎',
  '🪙', '🤝', '🏆', '💸', '🎰', '🎯', '🔥', '⭐',
  '🏦', '💰', '👋', '👑',
]

const blank = (): TaskInput => ({
  id: null,
  code: '',
  name: '',
  description: '',
  metric: 'ads_watched',
  target: 10,
  reward_points: 250,
  icon: '🎯',
  sort_order: 0,
  is_active: true,
})

const toInput = (task: AdminTask): TaskInput => ({
  id: task.id,
  code: task.code,
  name: task.name,
  description: task.description,
  metric: task.metric,
  target: task.target,
  reward_points: task.rewardPoints,
  icon: task.icon,
  sort_order: task.sortOrder,
  is_active: task.isActive,
})

export function TasksBoard({ tasks }: { tasks: AdminTask[] }) {
  const t = useTranslations('admin.tasks')
  const format = useFormatter()

  const [draft, setDraft] = useState<TaskInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  /* The task being edited, so its live counts can be shown in the panel.
     Deliberately NOT memoised: it is a find over a dozen rows, and a useMemo
     here blocked the React Compiler from optimising the whole component
     ("existing memoization could not be preserved") — a hand-written memo
     that costs more than it saves. */
  const editing = draft?.id ? (tasks.find((x) => x.id === draft.id) ?? null) : null

  const oneShot = draft ? ONE_SHOT_METRICS.includes(draft.metric) : false

  const patch = (next: Partial<TaskInput>) => {
    setSaved(false)
    setDraft((d) => (d ? { ...d, ...next } : d))
  }

  const save = () => {
    if (!draft) return
    setError(null)

    if (!/^[a-z][a-z0-9_]{2,40}$/.test(draft.code)) {
      setError(t('errors.code'))
      return
    }
    if (draft.name.trim().length === 0 || draft.description.trim().length === 0) {
      setError(t('errors.required'))
      return
    }

    startTransition(async () => {
      const result = await saveTask({
        ...draft,
        target: oneShot ? 1 : Math.max(1, Math.trunc(draft.target)),
        reward_points: Math.max(1, Math.trunc(draft.reward_points)),
      })
      if (!result.ok) setError(result.message)
      else {
        setSaved(true)
        setDraft(null)
      }
    })
  }

  const remove = (task: AdminTask) => {
    setError(null)
    startTransition(async () => {
      const result = await deleteTask(task.id)
      if (!result.ok) setError(result.message)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-500">{t('intro')}</p>
        <Button onClick={() => { setDraft(blank()); setError(null); setSaved(false) }}>
          <Plus aria-hidden className="size-4" />
          {t('new')}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-600">
          <Check aria-hidden className="size-4" />
          {t('saved')}
        </p>
      )}

      {/* ---- Editor ------------------------------------------------------ */}
      {draft && (
        <section className="rounded-(--radius-panel) border border-brand-500/30 bg-surface p-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">
            {draft.id ? t('editing') : t('creating')}
          </h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Text label={t('field.name')} value={draft.name} onChange={(v) => patch({ name: v })} />
            <Text
              label={t('field.code')}
              value={draft.code}
              onChange={(v) => patch({ code: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
              hint={t('field.codeHint')}
              disabled={Boolean(draft.id)}
            />
          </div>

          <label className="mt-3 block">
            <span className="text-[0.8125rem] font-medium text-ink-700">{t('field.description')}</span>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              maxLength={300}
              className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.875rem] text-ink-900"
            />
            <span className="text-[0.75rem] text-ink-400">{t('field.descriptionHint')}</span>
          </label>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-[0.8125rem] font-medium text-ink-700">{t('field.metric')}</span>
              <select
                value={draft.metric}
                onChange={(e) => patch({ metric: e.target.value as TaskMetric })}
                className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.875rem] text-ink-900"
              >
                {TASK_METRICS.map((m) => (
                  <option key={m} value={m}>{t(`metric.${m}`)}</option>
                ))}
              </select>
            </label>

            {/* Hidden for metrics that are their own answer. */}
            {!oneShot && (
              <Num label={t('field.target')} value={draft.target} onChange={(v) => patch({ target: v })} />
            )}
            <Num
              label={t('field.reward')}
              value={draft.reward_points}
              onChange={(v) => patch({ reward_points: v })}
            />
            <label className="block">
              <span className="text-[0.8125rem] font-medium text-ink-700">{t('field.icon')}</span>
              <input
                value={draft.icon}
                onChange={(e) => patch({ icon: e.target.value })}
                maxLength={12}
                aria-label={t('field.icon')}
                className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-center text-[1.25rem] leading-none text-ink-900"
              />
              <span className="text-[0.75rem] text-ink-400">{t('field.iconHint')}</span>
            </label>
          </div>

          {/* One tap for the common ones; the field above takes anything. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EMOJI_SUGGESTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => patch({ icon: emoji })}
                aria-label={t('field.useEmoji', { emoji })}
                className={cn(
                  'grid size-9 place-items-center rounded-(--radius-input) border text-[1.125rem] transition-colors',
                  draft.icon === emoji
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-ink-200 hover:border-ink-300',
                )}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* THE COST OF SAVING. */}
          {editing && (
            <p
              className={cn(
                'mt-3 rounded-(--radius-input) border px-3.5 py-2.5 text-[0.8125rem]',
                editing.eligibleNow > 0
                  ? 'border-warning-500/30 bg-warning-50 text-warning-600'
                  : 'border-ink-200 bg-ink-50 text-ink-600',
              )}
            >
              {t('cost', {
                people: format.number(editing.eligibleNow),
                points: format.number(editing.eligibleNow * draft.reward_points),
              })}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={save} loading={pending}>{t('save')}</Button>
            <button
              type="button"
              onClick={() => { setDraft(null); setError(null) }}
              className="text-[0.8125rem] font-medium text-ink-500 hover:text-ink-700"
            >
              {t('cancel')}
            </button>
          </div>
        </section>
      )}

      {/* ---- The list ----------------------------------------------------- */}
      <ol className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className={cn(
              'rounded-(--radius-panel) border bg-surface p-3.5',
              task.isActive ? 'border-ink-200' : 'border-dashed border-ink-200 opacity-60',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink-900">
                  <span aria-hidden className="text-[1.125rem] leading-none">
                    {task.icon?.trim() || '🎯'}
                  </span>
                  {task.name}
                  {!task.isActive && (
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-500">
                      {t('archived')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-ink-500">{task.description}</p>
                <p className="mt-1.5 font-mono text-[0.6875rem] text-ink-400">
                  {task.code} · {t(`metric.${task.metric}`)}
                  {task.target > 1 && ` ≥ ${format.number(task.target)}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4 text-right">
                <div>
                  <p className="text-[0.875rem] font-bold tabular-nums text-success-700">
                    +{format.number(task.rewardPoints)}
                  </p>
                  <p className="text-[0.6875rem] tabular-nums text-ink-400">
                    {t('claimedBy', { count: task.claimedCount })}
                  </p>
                  {task.eligibleNow > 0 && (
                    <p className="text-[0.6875rem] tabular-nums text-warning-600">
                      {t('waiting', { count: task.eligibleNow })}
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setDraft(toInput(task)); setError(null); setSaved(false) }}
                  >
                    {t('edit')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => remove(task)}
                    aria-label={t('remove')}
                    className="grid size-8 place-items-center rounded-(--radius-input) border border-ink-200 text-ink-400 transition-colors hover:border-danger-500/30 hover:text-danger-600"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Text({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[0.8125rem] font-medium text-ink-700">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.875rem] text-ink-900 disabled:opacity-60"
      />
      {hint && <span className="text-[0.75rem] text-ink-400">{hint}</span>}
    </label>
  )
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="text-[0.8125rem] font-medium text-ink-700">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-right text-[0.875rem] tabular-nums text-ink-900"
      />
    </label>
  )
}
