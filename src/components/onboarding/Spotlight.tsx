'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'

type Box = { top: number; left: number; width: number; height: number }

/** Distance between the element and the edge of the cutout. */
const PAD = 10
/** Corner radius of the cutout. Matched to the app's own cards, not to a
 *  library default, so the hole reads as part of the interface. */
const RADIUS = 14

/** A rounded rectangle, as an SVG path. */
function roundedRect({ top, left, width, height }: Box, r: number) {
  const x = left
  const y = top
  const w = width
  const h = height
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M${x + rr},${y}` +
    `H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}` +
    `V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}` +
    `H${x + rr}A${rr},${rr} 0 0 1 ${x},${y + h - rr}` +
    `V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}Z`
  )
}

/**
 * One SVG, with a rounded hole punched through it.
 *
 * ⚠️ WHY AN SVG AND NOT FOUR DIVS, WHICH IS WHAT THIS WAS. Four rectangles
 * framing the target leave a SQUARE hole with hard seams against a rounded
 * card, and every one of them takes taps, so the only reachable thing on the
 * screen is the exact element being pointed at. That is correct for "here is
 * your balance" and catastrophic for "go and watch an ad": the surveys tab,
 * every other card and the video player itself all sit under a shade, so the
 * step can never finish and the app looks frozen. Action steps do not use this
 * component at all now; they use the task bar, which dims nothing.
 *
 * A single path with `fill-rule: evenodd` gives a genuinely rounded hole, and
 * SVG hit-testing only applies to PAINTED area, so a tap in the hole reaches
 * the real element with nothing to opt out of. It renders back to the oldest
 * browser this app supports, unlike the `clip-path` and mask versions of the
 * same idea.
 *
 * The scrim is 50%, which is the settled default across every tour library.
 * At 75% the app behind it reads as switched off rather than as the thing
 * being explained.
 */
export function Spotlight({
  anchor,
  place = 'below',
  title,
  body,
  index,
  total,
  busy = false,
  onNext,
  onSkip,
}: {
  anchor: string
  place?: 'above' | 'below'
  title: string
  body: string
  index: number
  total: number
  busy?: boolean
  onNext: () => void
  onSkip: () => void
}) {
  const t = useTranslations('onboarding')

  /* The measurement is stored WITH the anchor it belongs to, so moving on
     makes it stale by definition and no reset has to run inside the effect. */
  const [measured, setMeasured] = useState<{ anchor: string; box: Box } | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
    if (!el) {
      setMeasured(null)
      return
    }
    const r = el.getBoundingClientRect()
    setMeasured({
      anchor,
      box: {
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      },
    })
  }, [anchor])

  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })

    /* Measure AFTER the scroll settles. Measuring during it pins the hole
       where the element was and leaves the member looking at a lit rectangle
       with nothing in it. */
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
  if (measured?.anchor !== anchor) return null

  const box = measured.box
  const { w: vw, h: vh } = viewport

  const spaceBelow = vh - (box.top + box.height)
  const showBelow = place === 'below' ? spaceBelow > 240 : spaceBelow > vh - box.top

  const hole = roundedRect(box, RADIUS)
  const screen = `M0,0H${vw}V${vh}H0Z`

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-100">
      <svg
        aria-hidden
        className="fixed inset-0 h-full w-full"
        style={{ pointerEvents: 'none' }}
      >
        {/* `pointer-events: auto` on the PATH, not the svg. The hole is unpainted,
            so it is not part of the path's hit area and a tap there lands on the
            real control underneath. */}
        <path
          d={`${screen}${hole}`}
          fillRule="evenodd"
          fill="rgb(15 23 42 / 0.5)"
          style={{ pointerEvents: 'auto' }}
        />
        {/* A hairline on the cutout, so the lit element has an edge rather than
            fading into whatever is behind it. */}
        <path d={hole} fill="none" stroke="rgb(255 255 255 / 0.9)" strokeWidth="1.5" />
      </svg>

      <div
        className="fixed w-[min(21rem,calc(100vw-2rem))] rounded-(--radius-panel) border border-ink-200 bg-surface p-4 shadow-[0_16px_48px_-12px_rgb(15_23_42/0.45)]"
        style={{
          top: showBelow ? box.top + box.height + 14 : undefined,
          bottom: showBelow ? undefined : Math.max(vh - box.top + 14, 16),
          left: Math.min(Math.max(box.left, 16), Math.max(vw - 352, 16)),
        }}
      >
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand-700">
          {t('progress', { index, total })}
        </p>
        <h2 className="mt-1.5 text-[0.9375rem] font-bold leading-snug text-ink-900">{title}</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t('skip')}
          </Button>
          <Button size="sm" onClick={onNext} loading={busy} trailingIcon={<ArrowRight />}>
            {t('next')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
