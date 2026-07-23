'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

type Quote = { text: string; name: string; role: string }

/**
 * Rotating testimonial, matching the reference layout.
 *
 * Two things it deliberately does not do:
 *
 *   - It does not autoplay for anyone who has asked for reduced motion.
 *     Content that changes under you is a genuine accessibility problem, not
 *     a stylistic one.
 *   - It does not use avatar photographs. Stock headshots attached to invented
 *     names read as fake the moment anyone reverse-image-searches them, and on
 *     a product asking people to trust it with money that is a bad trade.
 *     Initials in a tinted circle until real testimonials exist.
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

    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % quotes.length)
    }, 7000)
    return () => window.clearInterval(id)
  }, [paused, quotes.length])

  const quote = quotes[index]
  const initials = quote.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')

  return (
    <div
      className={cn('rounded-2xl bg-white/10 p-5 backdrop-blur-sm', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Announce changes politely rather than interrupting. */}
      <figure aria-live="polite" aria-atomic>
        <blockquote className="text-[0.9375rem] leading-relaxed text-white/90">
          {quote.text}
        </blockquote>

        <figcaption className="mt-4 flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-semibold text-white"
          >
            {initials}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-white">{quote.name}</span>
            <span className="text-xs text-white/70">{quote.role}</span>
          </span>
        </figcaption>
      </figure>

      {quotes.length > 1 && (
        <div className="mt-5 flex items-center gap-2">
          {quotes.map((q, i) => (
            <button
              key={q.name}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Testimonial ${i + 1} of ${quotes.length}`}
              aria-current={i === index || undefined}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
