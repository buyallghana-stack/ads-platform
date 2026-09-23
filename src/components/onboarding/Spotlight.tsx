'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { ArrowRight, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

type Box = { top: number; left: number; width: number; height: number }

/**
 * A hole cut in a dimmed screen, with a bubble beside it.
 *
 * ⚠️ FOUR DIVS, NOT `clip-path` OR A MASK. The obvious build is one full
 * screen overlay with a cut-out, and it is the build that breaks: the mask
 * properties that do it are exactly the modern CSS the cheap phones this app
 * is aimed at do not have, and the failure is a black screen with no way out
 * of it. Four opaque rectangles framing the target render everywhere, back to
 * the oldest browser we support, and they leave the hole genuinely untouched
 * rather than covered by a transparent layer.
 *
 * ⚠️ THE HOLE IS REALLY A HOLE. Nothing is painted over the target, so the tap
 * that the bubble is asking for reaches the real element underneath. A
 * transparent overlay there would produce the dead tap we have chased twice
 * before: the control looks right, highlights on press, and does nothing.
 */
export function Spotlight({
  anchor,
  place = 'below',
  title,
  body,
  waiting = false,
  index,
  total,
  onNext,
  onSkip,
}: {
  anchor: string
  place?: 'above' | 'below'
  title: string
  body: string
  /** The step ends when the member does the thing, so there is no Next. */
  waiting?: boolean
  index: number
  total: number
  onNext: () => void
  onSkip: () => void
}) {
  const t = useTranslations('onboarding')

  /*
    The measurement is stored WITH the anchor it belongs to, rather than beside
    a separate "ready" flag. Moving to the next step then makes the old
    measurement stale by definition, with nothing to reset: a reset would have
    to run synchronously inside the effect, which is a cascading render and a
    frame of the overlay framing whatever the previous step was pointing at.
  */
  const [measured, setMeasured] = useState<{ anchor: string; box: Box } | null>(null)

  const measure = useCallback(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
    if (!el) {
      setMeasured(null)
      return
    }
    const r = el.getBoundingClientRect()
    /* 8px of air so the ring never sits on the element's own border. */
    setMeasured({
      anchor,
      box: { top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 },
    })
  }, [anchor])

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })

    /*
      Measure AFTER the scroll has settled, not during it. Measuring
      immediately pins the frame where the element was, the smooth scroll then
      moves the element out from under it, and the member is left tapping a
      lit rectangle with nothing in it.
    */
    const settle = window.setTimeout(measure, 380)

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(settle)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor, measure])

  if (typeof document === 'undefined') return null

  /* Not measured yet, or measured for the step we have just left. Dim nothing
     and say nothing rather than framing the top left corner, which is what a
     missing element measures as. */
  if (measured?.anchor !== anchor) return null
  const box = measured.box

  const vh = window.innerHeight
  const vw = window.innerWidth
  const below = place === 'below' ? box.top + box.height + 16 : null
  const spaceBelow = vh - (box.top + box.height)
  /* Flip when the preferred side cannot hold the bubble. */
  const showBelow = below !== null && spaceBelow > 260

  const shade = 'fixed bg-ink-900/75'

  return createPortal(
    <div className="fixed inset-0 z-100" role="dialog" aria-modal="true" aria-label={title}>
      {/* The four shades. Each one takes taps, which is what makes the
          walkthrough sequential: nothing outside the hole is reachable. */}
      <div className={shade} style={{ top: 0, left: 0, right: 0, height: Math.max(box.top, 0) }} />
      <div
        className={shade}
        style={{ top: box.top + box.height, left: 0, right: 0, bottom: 0 }}
      />
      <div className={shade} style={{ top: box.top, left: 0, width: Math.max(box.left, 0), height: box.height }} />
      <div
        className={shade}
        style={{ top: box.top, left: box.left + box.width, right: 0, height: box.height }}
      />

      {/* The ring. `pointer-events-none` is the whole point: it is decoration
          drawn over the edge of a live control, and it must not intercept the
          tap the bubble just asked for. */}
      <div
        aria-hidden
        className="pointer-events-none fixed rounded-(--radius-card) ring-2 ring-brand-400"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      />

      <div
        className="fixed w-[min(22rem,calc(100vw-2rem))] rounded-(--radius-panel) border border-ink-200 bg-surface p-4 shadow-[0_16px_48px_-12px_rgb(15_23_42/0.45)]"
        style={{
          top: showBelow ? box.top + box.height + 16 : undefined,
          bottom: showBelow ? undefined : Math.max(vh - box.top + 16, 16),
          left: Math.min(Math.max(box.left, 16), Math.max(vw - 368, 16)),
        }}
      >
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand-700">
          {t('progress', { index, total })}
        </p>
        <h2 className="mt-1.5 text-[0.9375rem] font-bold leading-snug text-ink-900">{title}</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{body}</p>

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-[0.75rem] font-medium text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
          >
            {t('skip')}
          </button>

          {waiting ? (
            <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-semibold text-ink-500">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              {t('waiting')}
            </span>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-(--radius-control) bg-brand-600 px-4',
                'text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-700',
              )}
            >
              {t('next')}
              <ArrowRight aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
