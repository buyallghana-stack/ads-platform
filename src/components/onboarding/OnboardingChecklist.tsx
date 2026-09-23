'use client'

import { useState } from 'react'

import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { STEPS } from '@/components/onboarding/steps'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { OnboardingState } from '@/lib/onboarding/types'

/**
 * The checklist on Home.
 *
 * The spotlight runs once; this is what brings somebody back. It survives a
 * skip on purpose: a member who closed the walkthrough still has no payout
 * account, and this is the only thing left that says so.
 *
 * ⚠️ IT READS THE SAME DERIVED STATE AS THE WALKTHROUGH, so a row is ticked
 * because the thing is true rather than because a bubble was dismissed. That
 * is not a detail. A checklist that says "payout account: done" to somebody
 * with no payout account sends them to a withdrawal screen that refuses them,
 * which is precisely the experience the product is competing on not having.
 */
export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  const t = useTranslations('onboarding')
  const [open, setOpen] = useState(true)

  /* Finished, off, or never started: nothing to nag about. The card removing
     itself is the reward for finishing it. */
  if (!state.enabled || state.completed || state.steps.length === 0) return null

  const percent = Math.round((state.doneCount / Math.max(state.total, 1)) * 100)
  const next = state.steps.find((s) => !s.done)

  return (
    <section
      aria-labelledby="onboarding-checklist-title"
      className="overflow-hidden rounded-(--radius-panel) border border-brand-600/25 bg-surface"
    >
      <div className="flex items-center gap-3 border-b border-ink-200 bg-brand-50 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h2
            id="onboarding-checklist-title"
            className="text-[0.875rem] font-bold leading-snug text-ink-900"
          >
            {t('checklist.title')}
          </h2>
          <p className="mt-0.5 text-[0.75rem] text-ink-500">
            {t('checklist.progress', { done: state.doneCount, total: state.total })}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-(--radius-control) px-2 py-1.5 text-[0.75rem] font-medium text-ink-500 hover:bg-brand-600/10 hover:text-ink-700"
        >
          {open ? t('checklist.hide') : t('checklist.show')}
          {open ? (
            <ChevronUp aria-hidden className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5" />
          )}
        </button>
      </div>

      {/* The bar is decoration over a number that is already written above it,
          so it is hidden from a screen reader rather than repeated. */}
      <div aria-hidden className="h-1 w-full bg-ink-100">
        <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      {open && (
        <ul className="divide-y divide-ink-100">
          {state.steps.map((s) => {
            const descriptor = STEPS[s.key]
            const isNext = next?.key === s.key

            return (
              <li
                key={s.key}
                className={cn('flex items-center gap-3 px-4 py-3', isNext && 'bg-brand-50/60')}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border',
                    s.done
                      ? 'border-success-600 bg-success-600 text-white'
                      : isNext
                        ? 'border-brand-600 bg-surface text-brand-700'
                        : 'border-ink-200 bg-surface text-ink-300',
                  )}
                >
                  {s.done ? <Check className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-[0.8125rem] font-medium leading-snug',
                      s.done ? 'text-ink-400 line-through' : 'text-ink-900',
                    )}
                  >
                    {t(`checklist.steps.${s.key}`)}
                  </p>
                  {isNext && (
                    <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-500">
                      {t(`steps.${s.key}.body`)}
                    </p>
                  )}
                </div>

                {!s.done && descriptor && (
                  <Link
                    href={descriptor.route}
                    className="shrink-0 rounded-(--radius-control) bg-brand-600 px-3 py-1.5 text-[0.75rem] font-semibold text-white transition-colors hover:bg-brand-700"
                  >
                    {t('checklist.go')}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
