'use client'

import { useState, useTransition } from 'react'

import { ArrowDown, ArrowUp, Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { saveOnboardingSteps } from '@/app/[locale]/admin/(super)/onboarding/actions'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

export type StepRow = {
  key: string
  sortOrder: number
  isEnabled: boolean
  isDerived: boolean
}

/**
 * The walkthrough's order and switches.
 *
 * ⚠️ NO `TableShell`. This is edited far more often on a phone than a desktop
 * (an operator watching a funnel is not at a desk), and that component is
 * desktop only: without an `lg:hidden` card list beside it the screen is blank
 * on a phone. A list of rows is the honest shape for ten items with two
 * controls each, and it needs no second implementation.
 *
 * Reordering is up and down buttons rather than dragging. A drag needs a
 * pointer the audience does not have, and the accessible fallback for one is
 * a pair of buttons, so the fallback is simply the interface.
 */
export function OnboardingStepsEditor({ initial }: { initial: StepRow[] }) {
  const t = useTranslations('admin.onboarding')
  const [rows, setRows] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  const move = (index: number, by: -1 | 1) => {
    const next = [...rows]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setRows(next.map((r, i) => ({ ...r, sortOrder: i + 1 })))
    setDirty(true)
    setSaved(false)
  }

  const toggle = (key: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, isEnabled: !r.isEnabled } : r)))
    setDirty(true)
    setSaved(false)
  }

  const save = () => {
    setError(null)
    start(async () => {
      const result = await saveOnboardingSteps(
        rows.map((r) => ({ key: r.key, sortOrder: r.sortOrder, isEnabled: r.isEnabled })),
      )
      if (result.ok) {
        setDirty(false)
        setSaved(true)
      } else {
        setError(result.message ?? t('saveFailed'))
        setSaved(false)
      }
    })
  }

  return (
    <section className="rounded-(--radius-panel) border border-ink-200 bg-surface">
      <ul className="divide-y divide-ink-100">
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-center gap-3 px-4 py-3">
            <span className="w-6 shrink-0 text-[0.75rem] font-semibold tabular-nums text-ink-400">
              {i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-[0.875rem] font-semibold leading-snug',
                  row.isEnabled ? 'text-ink-900' : 'text-ink-400',
                )}
              >
                {t(`steps.${row.key}`)}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] leading-snug text-ink-500">
                {row.isDerived && <Lock aria-hidden className="size-3" />}
                {t(row.isDerived ? 'derived' : 'shown')}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={t('moveUp', { step: t(`steps.${row.key}`) })}
                className="grid size-8 place-items-center rounded-(--radius-control) text-ink-500 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
              >
                <ArrowUp aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label={t('moveDown', { step: t(`steps.${row.key}`) })}
                className="grid size-8 place-items-center rounded-(--radius-control) text-ink-500 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
              >
                <ArrowDown aria-hidden className="size-4" />
              </button>

              {/* A switch whose state is also written in words, because colour
                  on its own never says it. */}
              <button
                type="button"
                onClick={() => toggle(row.key)}
                aria-pressed={row.isEnabled}
                className={cn(
                  'ml-1 rounded-(--radius-control) px-2.5 py-1.5 text-[0.75rem] font-semibold transition-colors',
                  row.isEnabled
                    ? 'bg-success-50 text-success-700 hover:bg-success-100'
                    : 'bg-ink-100 text-ink-500 hover:bg-ink-200',
                )}
              >
                {t(row.isEnabled ? 'on' : 'off')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-4 py-3">
        <p className="text-[0.75rem] leading-snug text-ink-500">
          {error ? (
            <span className="font-medium text-danger-700">{error}</span>
          ) : saved ? (
            <span className="font-medium text-success-700">{t('saved')}</span>
          ) : (
            t('hint')
          )}
        </p>
        <Button onClick={save} disabled={!dirty} loading={pending}>
          {t('save')}
        </Button>
      </div>
    </section>
  )
}
