'use client'

import { useId, useState } from 'react'

import { AlertCircle, Check, Eye, EyeOff, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { evaluatePassword, PASSWORD_RULES, STRENGTH_LABEL_KEY } from '@/lib/password'

const STRENGTH_BAR: Record<number, string> = {
  0: 'w-0',
  1: 'w-1/5 bg-danger-500',
  2: 'w-2/5 bg-danger-500',
  3: 'w-3/5 bg-warning-500',
  4: 'w-4/5 bg-success-500',
  5: 'w-full bg-success-600',
}

/**
 * Password input with a live rule checklist (§6.1).
 *
 * The checklist is always rendered once the field has been touched, rather
 * than appearing only on failure. Telling someone what is still missing while
 * they type is the difference between one attempt and four, and on a platform
 * whose users are often on metered mobile data, four attempts is a real cost.
 *
 * `showChecklist` is off for login, where the rules are irrelevant — the
 * password either matches what was set or it does not.
 */
export function PasswordField({
  label,
  error,
  value,
  showChecklist = true,
  className,
  id: providedId,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type' | 'aria-describedby' | 'aria-invalid'> & {
  label: string
  error?: string
  value: string
  showChecklist?: boolean
}) {
  const t = useTranslations('auth.password')
  const tCommon = useTranslations('common')

  const [visible, setVisible] = useState(false)
  const [touched, setTouched] = useState(false)

  const generatedId = useId()
  const id = providedId ?? generatedId
  const errorId = `${id}-error`
  const checklistId = `${id}-checklist`
  const strengthId = `${id}-strength`

  const { results, strength } = evaluatePassword(value)
  const checklistVisible = showChecklist && (touched || value.length > 0)

  const describedBy = [
    error ? errorId : null,
    checklistVisible ? strengthId : null,
    checklistVisible ? checklistId : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-700">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onBlur={() => setTouched(true)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'h-12 w-full rounded-[--radius-input] bg-white pl-3.5 pr-12 text-[0.9375rem] text-ink-900',
            'ring-1 ring-inset transition-shadow duration-150',
            'placeholder:text-ink-400',
            'focus:outline-none focus-visible:ring-2',
            error
              ? 'ring-danger-500 focus-visible:ring-danger-600'
              : 'ring-ink-300 hover:ring-ink-400 focus-visible:ring-brand-600',
          )}
          {...props}
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Toggling visibility must not submit the form, and the control needs
          // its own name because the icon alone says nothing to a screen reader.
          aria-label={visible ? tCommon('hidePassword') : tCommon('showPassword')}
          aria-pressed={visible}
          className={cn(
            'absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-md',
            'text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600',
          )}
        >
          {visible ? (
            <EyeOff aria-hidden className="size-[1.125rem]" />
          ) : (
            <Eye aria-hidden className="size-[1.125rem]" />
          )}
        </button>
      </div>

      {checklistVisible && (
        <>
          <div id={strengthId} className="mt-1 flex items-center gap-2.5">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200"
              role="progressbar"
              aria-valuenow={strength}
              aria-valuemin={0}
              aria-valuemax={5}
              aria-label={t('strength')}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  STRENGTH_BAR[strength],
                )}
              />
            </div>
            <span
              className={cn(
                'w-20 shrink-0 text-right text-xs font-medium tabular-nums',
                strength >= 4 ? 'text-success-700' : strength >= 3 ? 'text-warning-600' : 'text-ink-500',
              )}
            >
              {t(STRENGTH_LABEL_KEY[strength])}
            </span>
          </div>

          <ul id={checklistId} className="mt-1.5 grid gap-1">
            {PASSWORD_RULES.map((rule) => {
              const passed = results[rule.id]
              return (
                <li
                  key={rule.id}
                  className={cn(
                    'flex items-center gap-1.5 text-xs transition-colors',
                    passed ? 'text-success-700' : 'text-ink-500',
                  )}
                >
                  {passed ? (
                    <Check aria-hidden className="size-3.5 shrink-0" />
                  ) : (
                    <X aria-hidden className="size-3.5 shrink-0 text-ink-300" />
                  )}
                  {t(`rules.${rule.id}`)}
                  {/* State in text as well as icon, for screen readers. */}
                  <span className="sr-only">{passed ? ' — met' : ' — not met'}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-danger-600"
        >
          <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
