'use client'

import { useMemo, useState } from 'react'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * The admin area's settings shell.
 *
 * WHY IT IS DATA-DRIVEN
 * Platform settings is forty controls across eight groups, and every one of
 * them is the same three things: a label, a sentence saying what it does, and
 * one input. Written as JSX that is forty near-identical blocks nobody will
 * keep consistent; written as a list of field descriptions it is one shape,
 * declared once, and adding a setting is adding a line.
 *
 * WHY NOTHING SAVES ON CHANGE
 * These are the numbers that decide how much money leaves the platform. A
 * daily points cap that applies the instant a digit is typed would apply
 * "5" on the way to typing "500". So edits collect, the bar appears once
 * something is genuinely different from what was loaded, and the operator
 * commits deliberately. `Discard` puts everything back — which is the only
 * reason it is safe to let them experiment with these at all.
 *
 * `danger` fields render red and are stated in terms of what they do to
 * users, not what they do to a column.
 */

export type FieldKind =
  | { kind: 'number'; min?: number; max?: number; step?: number; suffix?: string }
  | { kind: 'toggle' }
  | { kind: 'select'; options: { value: string; label: string }[] }

export type Field = {
  key: string
  label: string
  description?: string
  /** Shown under the control, in amber, when the value is risky. */
  warning?: string
  danger?: boolean
} & FieldKind

export type FieldGroup = {
  key: string
  title: string
  description?: string
  fields: Field[]
}

export type SettingsValues = Record<string, string | number | boolean>

export function SettingsForm({
  groups,
  initial,
}: {
  groups: FieldGroup[]
  initial: SettingsValues
}) {
  const t = useTranslations('admin.settingsForm')
  const [values, setValues] = useState<SettingsValues>(initial)
  const [saved, setSaved] = useState(false)

  const dirtyKeys = useMemo(
    () => Object.keys(values).filter((k) => values[k] !== initial[k]),
    [values, initial],
  )

  const set = (key: string, value: string | number | boolean) => {
    setValues((v) => ({ ...v, [key]: value }))
    setSaved(false)
  }

  return (
    <div className={cn(dirtyKeys.length > 0 && 'pb-20')}>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section
            key={group.key}
            className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface"
          >
            <div className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-[0.875rem] font-semibold tracking-[-0.01em] text-ink-900">
                {group.title}
              </h2>
              {group.description && (
                <p className="mt-1 max-w-[70ch] text-[0.75rem] leading-relaxed text-ink-500">
                  {group.description}
                </p>
              )}
            </div>

            <div className="divide-y divide-ink-200">
              {group.fields.map((field) => (
                <Row
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  dirty={values[field.key] !== initial[field.key]}
                  onChange={(v) => set(field.key, v)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {saved && (
        <p
          role="status"
          className="mt-4 rounded-(--radius-input) border border-success-500/25 bg-success-50 px-3 py-2.5 text-[0.8125rem] text-success-700"
        >
          {t('savedPreview')}
        </p>
      )}

      {/* One bar, appearing only when something actually changed. Counting the
          changes is not decoration — on a screen this long the operator has
          usually scrolled away from what they edited by the time they save. */}
      {dirtyKeys.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-(--radius-card) border border-ink-300 bg-ink-900 px-3 py-2.5 shadow-[0_12px_32px_-8px_rgb(15_23_42/0.4)] dark:bg-surface">
            <p className="min-w-0 flex-1 text-[0.75rem] font-medium text-canvas">
              {t('unsaved', { count: dirtyKeys.length })}
            </p>
            <button
              type="button"
              onClick={() => setValues(initial)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-(--radius-input) px-2.5 text-[0.75rem] font-medium text-canvas/80 transition-colors hover:bg-canvas/10 hover:text-canvas"
            >
              <RotateCcw aria-hidden className="size-3.5" />
              {t('discard')}
            </button>
            <button
              type="button"
              onClick={() => setSaved(true)}
              className="inline-flex h-8 shrink-0 items-center rounded-(--radius-input) bg-canvas px-3 text-[0.75rem] font-semibold text-ink-900 transition-opacity hover:opacity-90"
            >
              {t('save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Row({
  field,
  value,
  dirty,
  onChange,
}: {
  field: Field
  value: string | number | boolean
  dirty: boolean
  onChange: (v: string | number | boolean) => void
}) {
  const id = `setting-${field.key}`

  /*
    A switch belongs opposite the thing it switches, at every width — it is
    one glyph wide and reading "off" costs nothing when it sits on the right.
    A number or a select does not: shrunk into a corner of a 390px row it
    leaves the label two words per line, so those drop full-width underneath
    instead. Hence two layouts rather than one compromise.
  */
  const inlineOnMobile = field.kind === 'toggle'

  return (
    <div
      className={cn(
        'gap-3 px-4 py-3.5 transition-colors sm:flex sm:flex-row sm:items-center',
        inlineOnMobile ? 'flex flex-row items-center' : 'flex flex-col',
        dirty && 'bg-brand-50/40',
      )}
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn(
            'block text-[0.8125rem] font-medium',
            field.danger ? 'text-danger-700' : 'text-ink-900',
          )}
        >
          {field.label}
        </label>
        {field.description && (
          <p className="mt-0.5 max-w-[62ch] text-[0.75rem] leading-relaxed text-ink-500">
            {field.description}
          </p>
        )}
        {field.warning && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-warning-600">
            <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
            {field.warning}
          </p>
        )}
        {/* The column this writes to. An operator debugging with the database
            open should not have to guess which key a label maps to. */}
        <code className="mt-1.5 inline-block rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.625rem] text-ink-500">
          {field.key}
        </code>
      </div>

      <div className={cn('shrink-0 sm:w-52 sm:text-right', !inlineOnMobile && 'w-full sm:w-52')}>
        {field.kind === 'toggle' && (
          <Toggle
            id={id}
            checked={Boolean(value)}
            danger={field.danger}
            onChange={(v) => onChange(v)}
          />
        )}

        {field.kind === 'number' && (
          <div className="flex items-center gap-2 sm:justify-end">
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              step={field.step}
              value={String(value)}
              onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
              className="h-9 w-28 rounded-(--radius-input) border border-ink-200 bg-canvas px-2.5 text-right text-[0.8125rem] text-ink-900 tabular-nums focus:border-brand-600 focus:outline-none pointer-coarse:h-10 pointer-coarse:text-base"
            />
            {field.suffix && (
              <span className="text-[0.75rem] whitespace-nowrap text-ink-400">{field.suffix}</span>
            )}
          </div>
        )}

        {field.kind === 'select' && (
          <select
            id={id}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-2.5 text-[0.8125rem] text-ink-900 focus:border-brand-600 focus:outline-none pointer-coarse:h-10 pointer-coarse:text-base sm:w-52"
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

/**
 * Switch.
 *
 * A real checkbox underneath, so space toggles it and assistive technology
 * reads it as the control it is; the track and knob are decoration on top.
 * Replacing the input with a styled div is the usual shortcut and it breaks
 * keyboard operation and form semantics at once.
 */
function Toggle({
  id,
  checked,
  danger,
  onChange,
}: {
  id: string
  checked: boolean
  danger?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <span className="relative inline-flex sm:ml-auto">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'peer h-6 w-11 cursor-pointer appearance-none rounded-full border transition-colors',
          'border-ink-300 bg-ink-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
          danger
            ? 'checked:border-danger-600 checked:bg-danger-600'
            : 'checked:border-brand-600 checked:bg-brand-600',
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-0.5 size-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"
      />
    </span>
  )
}
