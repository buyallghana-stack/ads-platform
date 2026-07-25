'use client'

import { useEffect, useRef, useState } from 'react'

import { MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * Support chat launcher for the Home header.
 *
 * The chatbot itself is coming from the operator later, so this is the seat it
 * will sit in — placed and styled now so the header does not move when the
 * real widget arrives, and so the affordance is discoverable from day one.
 *
 * It says so rather than pretending. A chat button that opens nothing, or that
 * looks live and never answers, teaches people that support does not work
 * here — which is the opposite of what a support button is for. A small
 * honest note costs nothing and can be swapped for the widget in one place.
 *
 * Styling deliberately mirrors ThemeSwitchButton so the three header controls
 * read as one set; the dot is the only thing marking it as not-yet-live.
 */
export function SupportChatButton({ className }: { className?: string }) {
  const t = useTranslations('support')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('chat.label')}
        aria-expanded={open}
        className={cn(
          'grid size-9 place-items-center rounded-full text-ink-500 transition-colors',
          'hover:bg-ink-100 hover:text-ink-900',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
          'pointer-coarse:size-10',
          open && 'bg-ink-100 text-ink-900',
        )}
      >
        <MessageCircle aria-hidden className="size-[1.15rem]" />
        {/* Marks it as not live yet. Deliberately not the red unread dot the
            bell uses — that colour means "something needs you". */}
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-ink-300 ring-2 ring-canvas"
        />
      </button>

      {open && (
        <div
          role="status"
          className={cn(
            'absolute right-0 z-40 mt-2 w-[16rem] rounded-(--radius-card) border border-ink-200',
            'bg-surface p-3.5 text-left shadow-[0_12px_32px_-12px_rgb(15_23_42/0.28)]',
          )}
        >
          <p className="text-[0.8125rem] font-semibold text-ink-900">{t('chat.soonTitle')}</p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-500">{t('chat.soonBody')}</p>
        </div>
      )}
    </div>
  )
}
