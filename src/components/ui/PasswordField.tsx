'use client'

import { useId, useState } from 'react'

import { Check, Eye, EyeOff, Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { evaluatePassword, PASSWORD_RULES, STRENGTH_LABEL_KEY } from '@/lib/password'

const SEGMENT_ACTIVE: Record<number, string> = {
  0: 'bg-ink-200',
  1: 'bg-danger-500',
  2: 'bg-danger-500',
  3: 'bg-warning-500',
  4: 'bg-success-500',
  5: 'bg-success-600',
}

/**
 * Password input with a live rule checklist (§6.1).
 *
 * The meter is five discrete segments rather than one sliding bar: segments
 * map one-to-one onto the five rules, so the bar and the list below it are
 * telling the same story instead of two loosely-related ones.
 *
 * The checklist appears once the field is engaged rather than only on failure.
 * Telling someone what is still missing while they type is the difference
 * between one attempt and four — and four attempts is a real cost to a user
 * on metered mobile data.
 */
export function PasswordField({
  label,
  error,
  value,
  showChecklist = true,
  labelAccessory,
  className,
  id: providedId,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type' | 'aria-describedby' | 'aria-invalid'> & {
  label: string
  error?: string
  value: string
  showChecklist?: boolean
  /** e.g. a "Forgot password?" link sitting opposite the label. */
  labelAccessory?: React.ReactNode
}) {
  const t = useTranslations('auth.password')
  const tCommon = useTranslations('common')

  const [visible, setVisible] = useState(false)
  const [engaged, setEngaged] = useState(false)

  const generatedId = useId()
  const id = providedId ?? generatedId
  const errorId = `${id}-error`
  const checklistId = `${id}-checklist`
  const strengthId = `${id}-strength`

  const { results, strength } = evaluatePassword(value)
  const checklistVisible = showChecklist && (engaged || value.length > 0)

  const describedBy = [
    error ? errorId : null,
    checklistVisible ? strengthId : null,
    checklistVisible ? checklistId : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[0.8125rem] font-medium text-ink-700">
          {label}
        </label>
        {labelAccessory}
      </div>

      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
        >
          <Lock className="size-4" />
        </span>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onFocus={() => setEngaged(true)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'h-10 w-full rounded-(--radius-input) bg-surface pl-10 pr-10 text-sm text-ink-900',
            // See TextField: taller on touch, and 16px text stops iOS Safari
            // zooming the viewport on focus.
            'pointer-coarse:h-11 pointer-coarse:pr-12 pointer-coarse:text-base',
            'border transition-[border-color,box-shadow] duration-150',
            'placeholder:text-ink-400 focus:outline-none',
            error
              ? 'border-danger-500 focus:border-danger-600 focus:shadow-[0_0_0_3px] focus:shadow-danger-500/12'
              : 'border-ink-200 hover:border-ink-300 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12',
          )}
          {...props}
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Must not submit the form, and needs its own name because the icon
          // alone says nothing to a screen reader.
          aria-label={visible ? tCommon('hidePassword') : tCommon('showPassword')}
          aria-pressed={visible}
          className={cn(
            'absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md',
            'text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600',
            // A 28px hit area is well under the 44px touch minimum.
            'pointer-coarse:size-8',
          )}
        >
          {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>

      {checklistVisible && (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div
              className="flex flex-1 gap-1"
              role="progressbar"
              aria-valuenow={strength}
              aria-valuemin={0}
              aria-valuemax={5}
              aria-label={t('strength')}
            >
              {[1, 2, 3, 4, 5].map((seg) => (
                <span
                  key={seg}
                  className={cn(
                    'h-[3px] flex-1 rounded-full transition-colors duration-200',
                    seg <= strength ? SEGMENT_ACTIVE[strength] : 'bg-ink-200',
                  )}
                />
              ))}
            </div>
            <span
              className={cn(
                'shrink-0 text-[0.6875rem] font-medium tabular-nums',
                strength >= 4 ? 'text-success-700' : strength >= 3 ? 'text-warning-600' : 'text-ink-400',
              )}
            >
              {t(STRENGTH_LABEL_KEY[strength])}
            </span>
          </div>

          <ul id={checklistId} className="grid grid-cols-2 gap-x-3 gap-y-1">
            {PASSWORD_RULES.map((rule) => {
              const passed = results[rule.id]
              return (
                <li
                  key={rule.id}
                  className={cn(
                    'flex items-center gap-1.5 text-[0.75rem] transition-colors',
                    passed ? 'text-ink-600' : 'text-ink-400',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-3 shrink-0 place-items-center rounded-full transition-colors',
                      passed ? 'bg-success-600 text-white' : 'bg-ink-200',
                    )}
                  >
                    {passed && <Check className="size-2" strokeWidth={4} />}
                  </span>
                  {t(`rules.${rule.id}`)}
                  <span className="sr-only">{passed ? ' — met' : ' — not met'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {error}
        </p>
      )}

      <span id={strengthId} className="sr-only">
        {t('strength')}: {t(STRENGTH_LABEL_KEY[strength])}
      </span>
    </div>
  )
}
