'use client'

import { Search } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The furniture every admin list screen sits in.
 *
 * Extracted from the payout queue so the rest of the admin area inherits the
 * same layout rather than re-deciding it per screen. Eight screens that each
 * invent their own filter row is how a dashboard ends up feeling like eight
 * dashboards — which is the complaint that started this rebuild.
 *
 * The language, in one place:
 *   summary   hairline-separated numbers, never cards. Cards here would make
 *             the summary compete with the list, and the list is the work.
 *   tabs      underline, with a count chip. One exclusive choice, so it must
 *             not look like a row of independent toggles.
 *   table     one hairline border, no shadow, uppercase micro-headers,
 *             tabular numerals, and a fixed last column for the ⋯ menu.
 */

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export function SummaryStrip({
  cols = 3,
  className,
  children,
}: {
  cols?: 2 | 3 | 4
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'grid overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface',
        /*
          ONE COLUMN ON A PHONE, ALWAYS.
          Three cells across 390px leaves each about 110px, and "GHS 184,220"
          does not fit in 110px — it wrapped onto two lines, which is what
          made the finance and payout summaries look broken. Stacked, each
          cell becomes a label-left/value-right row that cannot wrap at any
          value length, and three rows cost less height than three wrapped
          cells did. The horizontal grid returns at `sm`, where the cells are
          genuinely wide enough for it.
        */
        'grid-cols-1 divide-y divide-ink-200',
        'sm:divide-x sm:divide-y-0',
        cols === 2 && 'sm:grid-cols-2',
        cols === 3 && 'sm:grid-cols-3',
        cols === 4 && 'sm:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SummaryCell({
  label,
  value,
  detail,
  /* Turns the number amber when it represents work waiting on the operator.
     Reserved for exactly that — colouring every figure teaches nothing. */
  emphasis,
}: {
  label: string
  value: string | number
  detail?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        // Phone: label and value on one line, pushed apart. Tablet up: the
        // label sits above the number, which is the shape the wide layout
        // wants and the narrow one cannot afford.
        'flex items-center justify-between gap-3 px-4 py-2.5',
        'sm:block sm:px-4 sm:py-3.5',
      )}
    >
      <p className="text-[0.75rem] leading-snug font-medium text-ink-500 sm:text-[0.6875rem]">
        {label}
      </p>
      {/* On a phone the detail stacks UNDER the value rather than beside it.
          It is not decoration — on the payout summary it is the money — so
          hiding it was not an option, and setting it beside a value like
          "GHS 184,220" is what ran the row off the edge in the first place. */}
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right sm:mt-1 sm:items-start sm:text-left lg:flex-row lg:items-baseline lg:gap-2">
        <span
          className={cn(
            'text-[1rem] leading-none font-semibold tabular-nums sm:text-[1.375rem]',
            emphasis ? 'text-warning-600' : 'text-ink-900',
          )}
        >
          {value}
        </span>
        {detail && (
          <span className="text-[0.6875rem] leading-snug text-ink-400 tabular-nums sm:text-[0.75rem]">
            {detail}
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tabs + search                                                       */
/* ------------------------------------------------------------------ */

export type Tab<T extends string> = { key: T; label: string; count?: number }

export function Toolbar<T extends string>({
  tabs,
  active,
  onSelect,
  tabsLabel,
  query,
  onQuery,
  searchPlaceholder,
  actions,
}: {
  tabs: Tab<T>[]
  active: T
  onSelect: (key: T) => void
  tabsLabel: string
  query?: string
  onQuery?: (value: string) => void
  searchPlaceholder?: string
  /** Buttons pinned to the right of the search field. */
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex flex-col gap-3 border-b border-ink-200 sm:flex-row sm:items-end sm:justify-between">
      <div
        role="tablist"
        aria-label={tabsLabel}
        className={cn(
          '-mb-px flex min-w-0 gap-1 overflow-x-auto pr-4',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          /* Fades the last tab out as it runs off rather than letting it be
             chopped flat against whatever sits beside it, which reads as an
             overlap bug instead of as "there is more this way". */
          '[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]',
        )}
      >
        {tabs.map((tab) => {
          const on = active === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onSelect(tab.key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5',
                'text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
                'focus-visible:bg-ink-50 focus-visible:outline-none',
                on
                  ? 'border-ink-900 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-900',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[0.6875rem] tabular-nums',
                    /* text-canvas, not text-white: the dark theme remaps
                       ink-900 to a near-white, so a hard white here vanished
                       into its own chip. Both tokens flip together. */
                    on ? 'bg-ink-900 text-canvas' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {(onQuery || actions) && (
        <div className="mb-2.5 flex items-center gap-2 sm:mb-2">
          {onQuery && (
            <div className="relative flex-1 sm:w-60 sm:flex-none">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-400"
              />
              <input
                type="search"
                value={query ?? ''}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9 w-full rounded-(--radius-input) border border-ink-200 bg-surface pr-3 pl-8 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none pointer-coarse:h-10 pointer-coarse:text-base"
              />
            </div>
          )}
          {actions}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface lg:block',
        className,
      )}
    >
      <table className="w-full">{children}</table>
    </div>
  )
}

export function Th({
  children,
  align = 'left',
  width,
  srOnly,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  /** Tailwind width class for the fixed columns (checkbox, ⋯). */
  width?: string
  srOnly?: boolean
}) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-2.5 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase',
        align === 'right' ? 'text-right' : 'text-left',
        width,
      )}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-16 text-center text-[0.8125rem] text-ink-400">
      {children}
    </p>
  )
}

/**
 * The stretched control that makes a row openable.
 *
 * A real button with a real accessible name, whose ::after covers the row —
 * so keyboard and screen-reader users get one "open this record" control per
 * row and mouse users get a clickable row. `onClick` on the `<tr>` gives
 * neither. The row needs `relative`, and anything meant to stay clickable
 * inside it (a checkbox, the ⋯ menu) needs `relative z-10`.
 */
export function RowOpener({
  label,
  onClick,
  rounded,
  children,
}: {
  label: string
  onClick: () => void
  /** Match the card radius when the row is a card rather than a table row. */
  rounded?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full min-w-0 text-left after:absolute after:inset-0 after:content-[""]',
        'focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-600',
        rounded ? 'focus-visible:after:rounded-(--radius-card)' : 'focus-visible:after:ring-inset',
      )}
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  )
}

/**
 * Checkbox for row selection.
 *
 * Drawn with a background-image tick rather than the Checkbox component
 * because that one ships a visible label and a 44px tap halo, both of which
 * are wrong inside a dense table cell.
 */
export function RowCheckbox({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
      className={cn(
        'relative z-10 size-4 cursor-pointer appearance-none rounded-[4px] border border-ink-300 bg-surface',
        'checked:border-brand-600 checked:bg-brand-600 checked:bg-center checked:bg-no-repeat',
        "checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22><path d=%22M3.5 8.5l3 3 6-6%22/></svg>')]",
        'disabled:cursor-default disabled:opacity-30',
      )}
    />
  )
}

/**
 * The floating bar that appears once rows are selected.
 *
 * Dark on light and light on dark, because it must read as a layer above the
 * page rather than another card on it.
 */
export function SelectionBar({
  summary,
  onClear,
  clearLabel,
  children,
}: {
  summary: string
  onClear: () => void
  clearLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-(--radius-card) border border-ink-300 bg-ink-900 px-3 py-2.5 shadow-[0_12px_32px_-8px_rgb(15_23_42/0.4)] dark:bg-surface">
        <p className="min-w-0 flex-1 text-[0.75rem] font-medium text-canvas">{summary}</p>
        {children}
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="grid size-8 shrink-0 place-items-center rounded-(--radius-input) text-canvas/70 transition-colors hover:bg-canvas/10 hover:text-canvas"
        >
          <span aria-hidden className="text-lg leading-none">
            ×
          </span>
        </button>
      </div>
    </div>
  )
}

/** Action button for inside the selection bar. */
export function SelectionAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-(--radius-input) bg-canvas px-3 text-[0.75rem] font-semibold text-ink-900 transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
