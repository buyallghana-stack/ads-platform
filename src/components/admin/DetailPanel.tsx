'use client'

import { useEffect, useRef } from 'react'

import { X } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The admin area's one way of showing a single record in depth.
 *
 * Extracted from the payout review panel once it became clear every admin
 * screen wants the same thing: a list you can scan, and a place to open one
 * row without losing the list. A user, an ad, an advertiser, an audit entry —
 * all the same shape, so all the same component. The alternative is eight
 * drawers that each drift slightly, which is how a dashboard stops feeling
 * like one product.
 *
 * Side panel from `sm`, bottom sheet below it. A 27rem drawer on a 390px
 * screen is a modal pretending not to be one, so on a phone it stops
 * pretending.
 *
 * Behaviour that is easy to leave out and always noticed when missing:
 * Escape closes, the scrim closes, focus moves into the panel on open and
 * back to the trigger on close, and the page behind stops scrolling.
 *
 * Callers that carry per-record state should mount this with `key={id}` so a
 * new record gets a fresh panel rather than a reset.
 */

export function DetailPanel({
  title,
  closeLabel,
  onClose,
  /** Rendered in the header, under the title row. */
  header,
  footer,
  /** Widen for records that genuinely need two columns of facts. */
  width = 'md',
  children,
}: {
  title: string
  closeLabel: string
  onClose: () => void
  header?: React.ReactNode
  footer?: React.ReactNode
  width?: 'md' | 'lg'
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      restoreFocusTo.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 animate-[scrim-in_150ms_ease-out] bg-ink-900/40 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-full w-full flex-col bg-surface focus:outline-none',
          'mt-auto max-h-[92dvh] animate-[panel-in-bottom_220ms_cubic-bezier(0.22,1,0.36,1)] rounded-t-(--radius-panel)',
          'sm:mt-0 sm:h-full sm:max-h-full sm:rounded-none sm:border-l sm:border-ink-200',
          'sm:animate-[panel-in-right_220ms_cubic-bezier(0.22,1,0.36,1)]',
          width === 'lg' ? 'sm:w-[34rem]' : 'sm:w-[27.5rem]',
        )}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-(--radius-input) text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer}
      </div>
    </div>
  )
}

/**
 * A titled block inside a panel. The uppercase micro-label is the only
 * hierarchy a panel needs — headings any louder start competing with the
 * record itself.
 */
export function PanelSection({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mt-5 first:mt-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[0.6875rem] font-semibold tracking-[0.05em] text-ink-400 uppercase">
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Label over value. Pairs up in a two-column grid; see PanelFacts. */
export function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] font-medium break-words text-ink-900">{value}</dd>
    </div>
  )
}

export function PanelFacts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
}

/** Small square icon control for inside a panel — reveal, copy, open. */
export function PanelIconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-[0.5rem] text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-900 [&>svg]:size-3.5"
    >
      {children}
    </button>
  )
}

/**
 * The panel's action bar. Sticky at the bottom, outside the scroll area, so
 * the decision is reachable without scrolling to the end of the evidence.
 */
export function PanelFooter({
  raised,
  children,
}: {
  /** Lifts the bar when it has grown over the content behind it. */
  raised?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'shrink-0 border-t border-ink-200 bg-surface px-5 py-4',
        'pb-[max(1rem,env(safe-area-inset-bottom))]',
        raised && 'shadow-[0_-10px_24px_-14px_rgb(15_23_42/0.35)]',
      )}
    >
      {children}
    </div>
  )
}
