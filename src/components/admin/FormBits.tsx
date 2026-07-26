'use client'

import { cn } from '@/lib/cn'

/**
 * The admin area's form controls.
 *
 * Same job AdminTable does for lists: one set of decisions about labels,
 * hints, error text and touch sizing, made once. The ad editor is the first
 * screen big enough that re-deciding them per field would show.
 *
 * `pointer-coarse:text-base` on every control is not a preference. Mobile
 * Safari zooms the page in on focus for anything under 16px and never zooms
 * back out, leaving the operator pinching their way around a form.
 */

export function inputClass(invalid?: boolean, className?: string) {
  return cn(
    'h-10 w-full rounded-(--radius-input) border bg-canvas px-3 text-[0.8125rem] text-ink-900',
    'placeholder:text-ink-400 focus:outline-none pointer-coarse:h-11 pointer-coarse:text-base',
    'disabled:cursor-not-allowed disabled:opacity-60',
    invalid ? 'border-danger-500 focus:border-danger-600' : 'border-ink-200 focus:border-brand-600',
    className,
  )
}

export function Field({
  label,
  hint,
  suffix,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  /** Unit, shown at the end of the label line rather than inside the box. */
  suffix?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[0.75rem] font-medium text-ink-700">{label}</span>
        {suffix && <span className="text-[0.6875rem] text-ink-400">{suffix}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? (
        <span role="alert" className="mt-1 block text-[0.6875rem] font-medium text-danger-600">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[0.625rem] leading-snug text-ink-400">{hint}</span>
      )}
    </label>
  )
}

/**
 * The same block for something that is NOT one input.
 *
 * `Field` is a `<label>`, and a label may only name a single control: wrap a
 * segmented control in one and the browser hands the whole label text — hint
 * included — to the first button as its accessible name, so a screen reader
 * announces "Status Status Only a live ad is served…" instead of "Draft".
 * Caught by a test that could not tell two radios apart, which is exactly
 * what an assistive-technology user would have hit.
 *
 * So anything with more than one control, or with its own aria-label, uses
 * this instead: same layout, plain elements, no naming relationship.
 */
export function FieldSet({
  label,
  hint,
  suffix,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  suffix?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.75rem] font-medium text-ink-700">{label}</span>
        {suffix && <span className="text-[0.6875rem] text-ink-400">{suffix}</span>}
      </div>
      <div className="mt-1">{children}</div>
      {error ? (
        <p role="alert" className="mt-1 text-[0.6875rem] font-medium text-danger-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-[0.625rem] leading-snug text-ink-400">{hint}</p>
      )}
    </div>
  )
}

/**
 * An exclusive choice of two or three, as a segmented control.
 *
 * Used where a dropdown would hide half the decision — video against survey,
 * YouTube against an uploaded file. Both options visible is the point: the
 * operator is choosing between two shapes of ad, not picking from a list.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex w-full rounded-(--radius-input) border border-ink-200 bg-ink-50 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-input)-2px)]',
              'px-3 py-2 text-[0.8125rem] font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {option.icon && <span aria-hidden className="[&>svg]:size-3.5">{option.icon}</span>}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** A real checkbox with the track drawn over it, so space toggles it and
 *  assistive technology reads a switch rather than a div. */
export function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'peer h-6 w-11 cursor-pointer appearance-none rounded-full border transition-colors',
          'border-ink-300 bg-ink-200 checked:border-brand-600 checked:bg-brand-600',
          'focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-0.5 size-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"
      />
    </span>
  )
}

/** A row that carries a switch: title, explanation, control. */
export function SwitchRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-ink-200 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium text-ink-900">{title}</p>
        {description && (
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  )
}

/** Selectable chip, for multi-select sets like the audience picker. */
export function ChoiceChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold',
        'transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none',
        selected
          ? 'border-violet-600/30 bg-violet-50 text-violet-700'
          : 'border-ink-200 bg-surface text-ink-500 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The editor's section wrapper: a card with a title and an explanation.
 *
 * FULL-BLEED ON A PHONE, CARD FROM `sm`. A form section holds question cards,
 * which hold option rows and condition boxes — on a 360px screen that is
 * three nested borders and about 60px of padding spent on chrome before any
 * content, which is what made the editor feel boxed in and uncontained. Below
 * `sm` the outer card gives up its side borders and its rounding and runs to
 * both screen edges (`-mx-4` cancels the admin main's `px-4`), so the width
 * goes to the fields and only the inner cards draw boxes.
 */
export function FormSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        '-mx-4 border-y border-ink-200 bg-surface px-4 py-4',
        'sm:mx-0 sm:rounded-(--radius-card) sm:border sm:p-5',
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-[62ch] text-[0.75rem] leading-relaxed text-ink-500">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}
