'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { MoreHorizontal } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The overflow ("three dots") menu.
 *
 * WHY THIS EXISTS
 * A table row that carries three or four labelled buttons stops being a row
 * of data and becomes a row of buttons: the eye lands on the controls instead
 * of the money, every row is a different width depending on which state it is
 * in, and on a phone the buttons wrap into a block taller than the record
 * they belong to. One trigger in a fixed column solves all three — the
 * actions live in the same place on every row, so they are found by muscle
 * memory rather than by reading.
 *
 * The trade is discoverability, and it is worth paying here because the
 * operator is a repeat user of one screen, not a first-time visitor. Where a
 * decision genuinely deserves full-size labelled buttons is the review panel,
 * where there is room for them and context to justify them — and that is
 * exactly where PayoutDrawer puts them.
 *
 * IMPLEMENTATION NOTES
 * The panel is portalled to <body> and positioned `fixed` from the trigger's
 * rect. Rendering it inside the row would clip it against the table's
 * `overflow-hidden` and trap it under the sticky header's stacking context;
 * portalling is the fix, and it costs a scroll listener that closes the menu
 * rather than a reposition loop.
 *
 * Keyboard behaviour is the full menu-button pattern: Down/Up roving focus,
 * Home/End, Escape closes and returns focus to the trigger, and opening with
 * a key lands on the first item.
 */

export type MenuItem = {
  key: string
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  /** Danger items render red and are pushed below a divider. */
  tone?: 'default' | 'danger'
  /** Sets the item apart from the one above it. */
  separated?: boolean
  disabled?: boolean
  /** Second line, for saying WHY an action is what it is. */
  hint?: string
}

const PANEL_WIDTH = 232
const MARGIN = 8

export function MoreMenu({
  items,
  label,
  align = 'end',
  className,
  triggerClassName,
}: {
  items: MenuItem[]
  /** Accessible name for the trigger — "Actions for RDM-4821", not "Menu". */
  label: string
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [active, setActive] = useState(-1)

  const enabled = items.filter((i) => !i.disabled)

  const close = (returnFocus = true) => {
    setOpen(false)
    setActive(-1)
    if (returnFocus) triggerRef.current?.focus()
  }

  /* Position from the trigger's rect, flipping above it when the panel would
     run off the bottom. Layout effect so the panel never paints in the wrong
     place first. */
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? items.length * 40 + 16

    const below = r.bottom + 6
    const flip = below + height > window.innerHeight - MARGIN && r.top - height - 6 > MARGIN

    const rawLeft = align === 'end' ? r.right - PANEL_WIDTH : r.left
    const left = Math.min(Math.max(MARGIN, rawLeft), window.innerWidth - PANEL_WIDTH - MARGIN)

    setPos({ top: flip ? r.top - height - 6 : below, left })
  }, [open, align, items.length])

  /* Outside click, Escape, and any scroll or resize. Scrolling closes rather
     than follows: a menu chasing the row down the page is worse than one that
     gets out of the way. */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    const onScroll = () => close(false)

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  /* Move real DOM focus with the active index — `aria-activedescendant` is the
     alternative and it is the one screen readers handle worse in menus. */
  useEffect(() => {
    if (!open || active < 0) return
    panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active]?.focus()
  }, [open, active])

  const openWith = (index: number) => {
    setOpen(true)
    setActive(index)
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openWith(0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openWith(enabled.length - 1)
    }
  }

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % enabled.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + enabled.length) % enabled.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(enabled.length - 1)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'inline-grid size-8 place-items-center rounded-(--radius-input) border border-transparent',
          'text-ink-400 transition-colors',
          'hover:border-ink-200 hover:bg-ink-50 hover:text-ink-700',
          'focus-visible:border-brand-600 focus-visible:outline-none',
          open && 'border-ink-200 bg-ink-50 text-ink-900',
          /* The visible control stays 32px so it sits comfortably in a dense
             row; the tappable area is stretched to 44 with a pseudo-element,
             the same trick Checkbox uses. */
          'pointer-coarse:before:absolute pointer-coarse:before:left-1/2 pointer-coarse:before:top-1/2',
          'pointer-coarse:before:size-11 pointer-coarse:before:-translate-x-1/2',
          'pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-[""]',
          triggerClassName,
        )}
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: PANEL_WIDTH }}
            className={cn(
              'fixed z-50 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface p-1',
              'shadow-[0_8px_28px_-6px_rgb(15_23_42/0.18),0_2px_6px_-2px_rgb(15_23_42/0.1)]',
              'origin-top animate-[menu-in_120ms_ease-out]',
            )}
          >
            {enabled.map((item, i) => (
              <div key={item.key}>
                {item.separated && <div className="my-1 h-px bg-ink-200" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => {
                    close()
                    item.onSelect()
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[0.5rem] px-2.5 py-2 text-left',
                    'text-[0.8125rem] font-medium transition-colors',
                    'focus:outline-none pointer-coarse:py-2.5',
                    item.tone === 'danger'
                      ? 'text-danger-700 hover:bg-danger-50 focus-visible:bg-danger-50'
                      : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900 focus-visible:bg-ink-100',
                  )}
                >
                  {item.icon && (
                    <span
                      aria-hidden
                      className={cn(
                        'mt-px shrink-0 [&>svg]:size-4',
                        item.tone === 'danger' ? 'text-danger-600' : 'text-ink-400',
                      )}
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block">{item.label}</span>
                    {item.hint && (
                      <span className="mt-0.5 block text-[0.6875rem] font-normal text-ink-400">
                        {item.hint}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
