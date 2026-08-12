'use client'

import { useEffect, useRef, useState } from 'react'

import { AdCover } from '@/components/ads/AdCover'

/**
 * Measures the real ad-card markup in whatever browser is looking at it, and
 * prints the answer at a size that survives being photographed.
 *
 * WHAT IT IS FOR. The iPhone 7 shows a cover with no height and a play disc
 * sitting on the title. Two fixes aimed at that have missed, both reasoned from
 * a model of Safari 15.6 rather than from Safari 15.6. These numbers come from
 * the browser itself: whether the cover has height, whether the card is a
 * column, whether the border survived, and which CSS features the engine
 * admits to supporting.
 *
 * Everything is read AFTER paint in an effect, because the server has no
 * layout and a hydration mismatch here would be its own red herring.
 */

type Row = { label: string; value: string; bad?: boolean }

export function CoverProbe() {
  const card = useRef<HTMLDivElement>(null)
  const cover = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    const read = () => {
      const cardEl = card.current
      const coverEl = cover.current
      if (!cardEl || !coverEl) return

      const cardBox = cardEl.getBoundingClientRect()
      const coverBox = coverEl.getBoundingClientRect()
      const cardStyle = getComputedStyle(cardEl)
      const coverStyle = getComputedStyle(coverEl)
      const spacer = coverEl.firstElementChild as HTMLElement | null
      const spacerBox = spacer?.getBoundingClientRect()

      /* The variable itself, straight off the element. Empty means `@property`
         never registered it, which is the whole hypothesis. */
      const borderVar = cardStyle.getPropertyValue('--tw-border-style').trim()

      const supports = (property: string, value: string) => {
        try {
          return CSS.supports(property, value)
        } catch {
          return false
        }
      }

      setRows([
        { label: 'screen', value: `${window.innerWidth} x ${window.innerHeight}` },
        {
          label: 'COVER HEIGHT',
          value: `${Math.round(coverBox.height)}px  (want ~${Math.round((coverBox.width * 9) / 16)})`,
          bad: coverBox.height < 40,
        },
        {
          label: 'spacer height',
          value: spacerBox ? `${Math.round(spacerBox.height)}px` : 'no spacer element',
          bad: !spacerBox || spacerBox.height < 40,
        },
        { label: 'cover width', value: `${Math.round(coverBox.width)}px` },
        { label: 'cover display', value: coverStyle.display },
        { label: 'cover overflow', value: coverStyle.overflow },
        { label: 'cover aspect-ratio', value: coverStyle.aspectRatio || '(none)' },
        { label: 'card width', value: `${Math.round(cardBox.width)}px` },
        {
          label: 'card direction',
          value: `${cardStyle.display} / ${cardStyle.flexDirection}`,
          bad: cardStyle.flexDirection !== 'column',
        },
        {
          label: 'card border',
          value: `${cardStyle.borderTopStyle} ${cardStyle.borderTopWidth}`,
          bad: cardStyle.borderTopStyle === 'none' || parseFloat(cardStyle.borderTopWidth) === 0,
        },
        {
          label: '--tw-border-style',
          value: borderVar === '' ? '(EMPTY)' : borderVar,
          bad: borderVar === '',
        },
        {
          label: '@property',
          value: typeof CSS !== 'undefined' && 'registerProperty' in CSS ? 'yes' : 'NO',
          bad: !(typeof CSS !== 'undefined' && 'registerProperty' in CSS),
        },
        {
          label: 'aspect-ratio',
          value: supports('aspect-ratio', '16 / 9') ? 'yes' : 'NO',
        },
        {
          label: 'color-mix',
          value: supports('color', 'color-mix(in oklab, red, blue)') ? 'yes' : 'NO',
        },
        { label: 'gap in flex', value: supports('gap', '1px') ? 'yes' : 'NO' },
        { label: 'inset', value: supports('inset', '0') ? 'yes' : 'NO' },
        { label: 'place-items', value: supports('place-items', 'center') ? 'yes' : 'NO' },
        { label: 'browser', value: navigator.userAgent.slice(0, 90) },
      ])
    }

    /* Twice: once now and once after a beat, because a webfont or a lazy image
       landing late can change a box, and the second number is the honest one. */
    read()
    const timer = setTimeout(read, 700)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-dvh bg-canvas px-4 py-6">
      <h1 className="text-[1.125rem] font-bold text-ink-900">Layout probe</h1>
      <p className="mt-1 text-[0.8125rem] text-ink-500">
        Photograph this whole screen, including the card at the bottom.
      </p>

      <div className="mt-4 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
        {rows === null ? (
          <p className="px-3 py-3 text-[0.875rem] text-ink-500">measuring…</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-b border-ink-100 px-3 py-2 last:border-b-0"
            >
              <span className="text-[0.75rem] text-ink-500">{row.label}</span>
              <span
                className={
                  row.bad
                    ? 'text-right font-mono text-[0.8125rem] font-bold text-danger-600'
                    : 'text-right font-mono text-[0.8125rem] text-ink-900'
                }
              >
                {row.value}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="mt-5 text-[0.75rem] text-ink-500">
        The card below is the real one, with the real classes.
      </p>

      {/* The ad card's own markup, copied rather than imported, because the
          card takes a feed row and this page has no database. The classes are
          the ones that matter: the flex column, the border, the cover. */}
      <div
        ref={card}
        className="group relative mt-2 flex h-full w-full flex-col overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface text-left"
      >
        <div ref={cover} className="relative">
          <AdCover seed="probe-seed" src={null} title="Probe" format="video" className="w-full" />
          <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-black/45 text-white">
              <span className="text-[1.25rem] leading-none">▶</span>
            </span>
          </span>
        </div>
        <div className="flex items-start gap-3 px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-input) bg-brand-600 text-[0.875rem] font-bold text-white">
            P
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-semibold text-ink-900">
              A title long enough to wrap onto a second line
            </span>
            <span className="block text-[0.8125rem] text-ink-500">Advertiser</span>
          </span>
        </div>
      </div>
    </div>
  )
}
