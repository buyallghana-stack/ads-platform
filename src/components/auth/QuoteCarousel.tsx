'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

type Quote = { text: string; name: string; role: string }

/**
 * Rotating testimonial.
 *
 * No card around it — the earlier translucent panel-within-a-panel added a
 * second edge inside an already-bounded space. A hairline rule above the
 * quote separates it just as clearly and keeps the panel calm.
 *
 * Two deliberate omissions:
 *   - No autoplay for anyone who has asked for reduced motion. Content that
 *     changes under you is an accessibility problem, not a stylistic one.
 *   - No avatar photographs. Stock headshots on invented names read as fake
 *     the moment anyone reverse-image-searches them, which is a poor trade on
 *     a product asking to be trusted with money.
 */
export function QuoteCarousel({ className }: { className?: string }) {
  const t = useTranslations('auth.panel')
  const quotes = t.raw('quotes') as Quote[]

  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || quotes.length < 2) return

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const id = window.setInterval(() => setIndex((i) => (i + 1) % quotes.length), 7000)
    return () => window.clearInterval(id)
  }, [paused, quotes.length])

  const quote = quotes[index]
  const initials = quote.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')

  return (
    <div
      className={cn('border-t border-white/15 pt-5', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <figure aria-live="polite" aria-atomic>
        <blockquote className="text-[0.8125rem] leading-relaxed text-white/80">
          “{quote.text}”
        </blockquote>

        <figcaption className="mt-3.5 flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white/15 text-[0.6875rem] font-semibold text-white"
          >
            {initials}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[0.8125rem] font-medium text-white">{quote.name}</span>
            <span className="text-[0.6875rem] text-white/55">{quote.role}</span>
          </span>
        </figcaption>
      </figure>

      {quotes.length > 1 && (
        <div className="mt-4 flex items-center gap-1.5">
          {quotes.map((q, i) => (
            <button
              key={q.name}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Testimonial ${i + 1} of ${quotes.length}`}
              aria-current={i === index || undefined}
              className={cn(
                'h-[3px] rounded-full transition-all duration-300',
                i === index ? 'w-5 bg-white/90' : 'w-[3px] bg-white/35 hover:bg-white/60',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
