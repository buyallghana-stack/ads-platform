'use client'

import { useMemo, useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'

import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  affiliateTaskExposure,
  deleteAffiliateTask,
  saveAffiliatePrizes,
  saveAffiliateTask,
} from '@/app/[locale]/admin/(super)/affiliates/rewards/actions'
import type {
  AdminAffiliatePrize,
  AdminAffiliateTask,
  AffiliateGame,
} from '@/lib/admin/data/affiliate-rewards'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * What the affiliate games and tasks pay.
 *
 * ── THE COST OF A CHANGE IS ON SCREEN BEFORE IT IS SAVED ──
 *
 * Two numbers do that work, and they are the reason this screen exists rather
 * than a row of inputs:
 *
 *   the average play   weights times amounts, over total weight. What one
 *                      spin costs the business on average, in cedis. An
 *                      operator setting a GHS 25 prize at weight 4 cannot do
 *                      that arithmetic in their head, and the number they
 *                      would guess is always too low.
 *   eligible now       how many affiliates could claim a task the instant a
 *                      reward is set. These tasks are RETROACTIVE: a reward on
 *                      "make your first sale" pays everybody who ever made
 *                      one. That is money leaving on save.
 *
 * ── NOTHING SAVES ON CHANGE ──
 *
 * Same rule as Platform settings, for the same reason: typing "500" passes
 * through "5" and "50", and each of those is a prize somebody could win.
 * Edits collect, a bar appears, the operator commits.
 */

type Tab = 'prizes' | 'tasks'

const METRICS = ['sales', 'referrals', 'games_played', 'leaderboard_rank'] as const

export function AffiliateRewards({
  game,
  prizes,
  tasks,
}: {
  game: AffiliateGame
  prizes: AdminAffiliatePrize[]
  tasks: AdminAffiliateTask[]
}) {
  const t = useTranslations('admin.affiliateRewards')
  const [tab, setTab] = useState<Tab>('prizes')

  return (
    <>
      <nav className="mb-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1">
        {(['prizes', 'tasks'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={key === tab ? 'page' : undefined}
            className={cn(
              'flex-1 rounded-[calc(var(--radius-input)-0.25rem)] px-3 py-2 text-center',
              'text-[0.8125rem] font-semibold transition-colors',
              key === tab
                ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </nav>

      {tab === 'prizes' ? (
        <PrizeTable game={game} initial={prizes} />
      ) : (
        <TaskTable initial={tasks} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Prizes                                                              */
/* ------------------------------------------------------------------ */

function PrizeTable({ game, initial }: { game: AffiliateGame; initial: AdminAffiliatePrize[] }) {
  const t = useTranslations('admin.affiliateRewards')
  /* The game lives in the URL, as it does on the points games screen: an
     operator comparing two economies wants two tabs open, and each table is a
     separate fetch. */
  const router = useRouter()

  const [rows, setRows] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  /* Live economics. Weight 0 means "configured but never drawn", so it counts
     towards neither the odds nor the cost. */
  const economics = useMemo(() => {
    const active = rows.filter((r) => r.isActive && r.weight > 0)
    const total = active.reduce((sum, r) => sum + r.weight, 0)
    const average =
      total === 0 ? 0 : active.reduce((sum, r) => sum + r.weight * r.amountMinor, 0) / total
    const extra = total === 0 ? 0 : active.reduce((sum, r) => sum + r.weight * r.extraPlays, 0) / total
    return { total, average, extra }
  }, [rows])

  const update = (slot: number, patch: Partial<AdminAffiliatePrize>) => {
    setSaved(false)
    setDirty(true)
    setRows((current) => current.map((r) => (r.slot === slot ? { ...r, ...patch } : r)))
  }

  const save = () =>
    startTransition(async () => {
      setError(null)
      const result = await saveAffiliatePrizes(
        game,
        rows.map((r) => ({
          id: r.id,
          slot: r.slot,
          label: r.label,
          amount_minor: r.amountMinor,
          extra_plays: r.extraPlays,
          weight: r.weight,
          colour: r.colour,
          is_active: r.isActive,
        })),
      )
      if (result.ok) {
        if (result.prizes) setRows(result.prizes)
        setDirty(false)
        setSaved(true)
      } else {
        setError(result.message)
      }
    })

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-2">
        {(['mystery_box', 'spin_wheel'] as AffiliateGame[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => router.replace(`/admin/affiliates/rewards?game=${key}`)}
            aria-current={key === game ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors',
              key === game
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300',
            )}
          >
            {t(`game.${key}`)}
          </button>
        ))}
      </nav>

      {/* The number an operator cannot work out in their head. */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label={t('economics.average')} value={cedis(Math.round(economics.average))} loud />
        <Figure label={t('economics.weight')} value={String(economics.total)} />
        <Figure label={t('economics.extra')} value={economics.extra.toFixed(2)} />
      </section>
      <p className="-mt-2 text-[0.75rem] leading-snug text-ink-500">{t('economics.note')}</p>

      {error && <Alert>{error}</Alert>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <thead>
            <tr className="border-b border-ink-200">
              {['slot', 'label', 'amount', 'extra', 'weight', 'odds', 'colour', 'won', 'active'].map((key) => (
                <th
                  key={key}
                  className="px-2 py-2 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase"
                >
                  {t(`col.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const odds =
                economics.total === 0 || !row.isActive
                  ? 0
                  : (row.weight / economics.total) * 100
              return (
                <tr key={row.id} className="border-b border-ink-200 last:border-b-0">
                  <td className="px-2 py-2 text-[0.8125rem] tabular-nums text-ink-500">{row.slot}</td>
                  <td className="px-2 py-2">
                    <input
                      value={row.label}
                      onChange={(e) => update(row.slot, { label: e.target.value })}
                      className="w-full min-w-[7rem] rounded-(--radius-input) border border-ink-200 bg-surface px-2 py-1.5 text-[0.8125rem] text-ink-900 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
                    />
                  </td>
                  <td className="px-2 py-2">
                    {/* In MAJOR units, because an operator thinks in cedis.
                        Converted once, here, so nothing downstream carries a
                        float. */}
                    <input
                      inputMode="decimal"
                      value={(row.amountMinor / 100).toString()}
                      onChange={(e) =>
                        update(row.slot, {
                          amountMinor: Math.max(0, Math.round(Number(e.target.value || 0) * 100)),
                        })
                      }
                      className="w-20 rounded-(--radius-input) border border-ink-200 bg-surface px-2 py-1.5 text-[0.8125rem] tabular-nums text-ink-900 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      inputMode="numeric"
                      value={row.extraPlays}
                      onChange={(e) =>
                        update(row.slot, { extraPlays: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-14 rounded-(--radius-input) border border-ink-200 bg-surface px-2 py-1.5 text-[0.8125rem] tabular-nums text-ink-900 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      inputMode="numeric"
                      value={row.weight}
                      onChange={(e) =>
                        update(row.slot, { weight: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-16 rounded-(--radius-input) border border-ink-200 bg-surface px-2 py-1.5 text-[0.8125rem] tabular-nums text-ink-900 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
                    />
                  </td>
                  <td className="px-2 py-2 text-[0.8125rem] tabular-nums text-ink-600">
                    {odds.toFixed(1)}%
                  </td>
                  <td className="px-2 py-2">
                    {/* The wheel draws its wedges in these colours, so this is
                        not decoration: a prize with no colour renders as the
                        fallback violet and every wedge looks the same. */}
                    <input
                      type="color"
                      aria-label={t('col.colour')}
                      value={row.colour ?? '#7c3aed'}
                      onChange={(e) => update(row.slot, { colour: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded border border-ink-200 bg-canvas"
                    />
                  </td>
                  <td className="px-2 py-2 text-[0.75rem] tabular-nums whitespace-nowrap text-ink-500">
                    {row.timesWon} · {cedis(row.paidMinor)}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => update(row.slot, { isActive: e.target.checked })}
                      className="size-4 accent-[var(--color-brand-600)]"
                      aria-label={t('col.active')}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <SaveBar
        dirty={dirty}
        saved={saved}
        pending={pending}
        onSave={save}
        onDiscard={() => {
          setRows(initial)
          setDirty(false)
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function TaskTable({ initial }: { initial: AdminAffiliateTask[] }) {
  const t = useTranslations('admin.affiliateRewards')

  const [tasks, setTasks] = useState(initial)
  const [editing, setEditing] = useState<AdminAffiliateTask | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const blank: AdminAffiliateTask = {
    id: '',
    code: '',
    name: '',
    description: null,
    metric: 'sales',
    target: 1,
    rewardMinor: 0,
    icon: '🎯',
    sortOrder: (tasks.at(-1)?.sortOrder ?? 0) + 10,
    isActive: true,
    claimedCount: 0,
    paidMinor: 0,
    eligibleNow: 0,
  }

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteAffiliateTask(id)
      if (result.ok) {
        if (result.tasks) setTasks(result.tasks)
        setNote(result.note === 'archived' ? t('archived') : t('deleted'))
        setError(null)
      } else {
        setError(result.message)
      }
    })

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {note && (
        <p className="flex items-start gap-2 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3 text-[0.8125rem] text-ink-700">
          <Check aria-hidden className="mt-px size-4 shrink-0 text-success-600" />
          {note}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing(blank)}
          className="inline-flex items-center gap-2 rounded-(--radius-input) bg-brand-600 px-3.5 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          <Plus aria-hidden className="size-4" />
          {t('newTask')}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className={cn(
              'rounded-(--radius-panel) border p-3.5',
              task.isActive ? 'border-ink-200 bg-surface' : 'border-ink-200 bg-ink-50',
            )}
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="text-[1.125rem]">
                {task.icon ?? '🎯'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-semibold text-ink-900">
                  {task.name}
                  {!task.isActive && (
                    <span className="ml-2 text-[0.6875rem] font-medium text-ink-400">
                      {t('inactive')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-ink-500">
                  {t(`metric.${task.metric}`)} · {t('targetIs', { n: task.target })}
                </p>
                <p className="mt-1 text-[0.75rem] text-ink-500">
                  {t('claimedSoFar', { n: task.claimedCount, amount: cedis(task.paidMinor) })}
                  {task.rewardMinor > 0 && task.eligibleNow > 0 && (
                    <span className="ml-1 font-medium text-warning-600">
                      {t('eligibleNow', {
                        n: task.eligibleNow,
                        amount: cedis(task.eligibleNow * task.rewardMinor),
                      })}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-success-500/12 px-2.5 py-1 text-[0.75rem] font-bold whitespace-nowrap tabular-nums text-success-600">
                  {cedis(task.rewardMinor)}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(task)}
                  className="rounded-(--radius-input) border border-ink-300 px-2.5 py-1.5 text-[0.75rem] font-semibold text-ink-700 hover:border-ink-400"
                >
                  {t('edit')}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(task.id)}
                  aria-label={t('remove', { name: task.name })}
                  className="grid size-8 place-items-center rounded-(--radius-input) text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <TaskForm
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setTasks(next)
            setEditing(null)
            setError(null)
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function TaskForm({
  task,
  onClose,
  onSaved,
  onError,
}: {
  task: AdminAffiliateTask
  onClose: () => void
  onSaved: (tasks: AdminAffiliateTask[]) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.affiliateRewards')

  const [draft, setDraft] = useState(task)
  const [exposure, setExposure] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()

  /* Asked on demand rather than on every keystroke: it walks every affiliate
     account and this screen is not worth a query per digit. */
  const check = () =>
    startTransition(async () => {
      const result = await affiliateTaskExposure({
        metric: draft.metric,
        target: draft.target,
        taskId: draft.id || undefined,
      })
      setExposure(result?.people ?? 0)
    })

  const save = () =>
    startTransition(async () => {
      const result = await saveAffiliateTask({
        id: draft.id || undefined,
        name: draft.name,
        description: draft.description ?? undefined,
        metric: draft.metric,
        target: draft.target,
        reward_minor: draft.rewardMinor,
        icon: draft.icon ?? undefined,
        sort_order: draft.sortOrder,
        is_active: draft.isActive,
      })
      if (result.ok && result.tasks) onSaved(result.tasks)
      else if (!result.ok) onError(result.message)
    })

  const field =
    'w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.8125rem] text-ink-900 focus:border-brand-600 focus:outline-none pointer-coarse:text-base'

  return (
    <section className="rounded-(--radius-panel) border border-brand-600/30 bg-brand-50 p-4">
      <p className="text-[0.875rem] font-semibold text-ink-900">
        {draft.id ? t('editing', { name: task.name }) : t('newTask')}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[0.75rem] text-ink-600">{t('form.name')}</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={cn(field, 'mt-1')}
          />
        </label>

        <label className="block">
          <span className="text-[0.75rem] text-ink-600">{t('form.icon')}</span>
          <input
            value={draft.icon ?? ''}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
            className={cn(field, 'mt-1')}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-[0.75rem] text-ink-600">{t('form.description')}</span>
          <input
            value={draft.description ?? ''}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className={cn(field, 'mt-1')}
          />
        </label>

        <label className="block">
          <span className="text-[0.75rem] text-ink-600">{t('form.metric')}</span>
          <select
            value={draft.metric}
            disabled={draft.claimedCount > 0}
            onChange={(e) =>
              setDraft({ ...draft, metric: e.target.value as AdminAffiliateTask['metric'] })
            }
            className={cn(field, 'mt-1', draft.claimedCount > 0 && 'cursor-not-allowed opacity-60')}
          >
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {t(`metric.${m}`)}
              </option>
            ))}
          </select>
          {draft.claimedCount > 0 && (
            <span className="mt-1 block text-[0.6875rem] leading-snug text-ink-500">
              {t('form.metricLocked')}
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-[0.75rem] text-ink-600">
            {draft.metric === 'leaderboard_rank' ? t('form.rank') : t('form.target')}
          </span>
          <input
            inputMode="numeric"
            value={draft.target}
            onChange={(e) => {
              setExposure(null)
              setDraft({ ...draft, target: Math.max(1, Number(e.target.value) || 1) })
            }}
            className={cn(field, 'mt-1')}
          />
        </label>

        <label className="block">
          <span className="text-[0.75rem] text-ink-600">{t('form.reward')}</span>
          <input
            inputMode="decimal"
            value={(draft.rewardMinor / 100).toString()}
            onChange={(e) =>
              setDraft({
                ...draft,
                rewardMinor: Math.max(0, Math.round(Number(e.target.value || 0) * 100)),
              })
            }
            className={cn(field, 'mt-1')}
          />
        </label>

        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            className="size-4 accent-[var(--color-brand-600)]"
          />
          <span className="text-[0.8125rem] text-ink-700">{t('form.active')}</span>
        </label>
      </div>

      {/* THE COST OF SAVING, before saving. */}
      <div className="mt-3 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-3.5 py-3">
        <p className="text-[0.75rem] leading-snug text-ink-700">
          {exposure === null
            ? t('exposure.ask')
            : t('exposure.answer', {
                n: exposure,
                amount: cedis(exposure * draft.rewardMinor),
              })}
        </p>
        <button
          type="button"
          onClick={check}
          disabled={pending}
          className="mt-2 rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-1.5 text-[0.75rem] font-semibold text-ink-700 hover:border-ink-400"
        >
          {t('exposure.check')}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || draft.name.trim().length === 0}
          onClick={save}
          className="rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:bg-ink-100 disabled:text-ink-400"
        >
          {t('save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-(--radius-input) border border-ink-300 px-4 py-2.5 text-[0.875rem] font-semibold text-ink-700"
        >
          {t('cancel')}
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Furniture                                                           */
/* ------------------------------------------------------------------ */

function Figure({ label, value, loud }: { label: string; value: string; loud?: boolean }) {
  return (
    <div className="rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3">
      <p className="text-[0.6875rem] text-ink-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-[1.25rem] leading-none font-semibold tabular-nums',
          loud ? 'text-warning-600' : 'text-ink-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 px-4 py-3 text-[0.8125rem] text-ink-900"
    >
      <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-600" />
      {children}
    </p>
  )
}

function SaveBar({
  dirty,
  saved,
  pending,
  onSave,
  onDiscard,
}: {
  dirty: boolean
  saved: boolean
  pending: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  const t = useTranslations('admin.affiliateRewards')

  if (!dirty) {
    return saved ? (
      <p className="flex items-center gap-2 text-[0.8125rem] text-success-600">
        <Check aria-hidden className="size-4" />
        {t('savedNote')}
      </p>
    ) : null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-brand-600/30 bg-brand-50 px-4 py-3">
      <p className="min-w-0 flex-1 text-[0.8125rem] text-ink-700">{t('unsaved')}</p>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded-(--radius-input) border border-ink-300 px-3 py-2 text-[0.8125rem] font-semibold text-ink-700"
      >
        {t('discard')}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onSave}
        className="rounded-(--radius-input) bg-brand-600 px-4 py-2 text-[0.8125rem] font-semibold text-white hover:bg-brand-500 disabled:bg-ink-100 disabled:text-ink-400"
      >
        {t('save')}
      </button>
    </div>
  )
}
