'use client'

import { useMemo, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'

import type { PerformancePoint } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * Earnings and clicks over the window, on one plot with two y-axes.
 *
 * ── A NOTE ON THE DUAL AXIS, BECAUSE IT IS NORMALLY THE WRONG ANSWER ──
 *
 * The ads dashboard's chart deliberately refuses this: it shows one series at
 * a time, because with two scales the point where the lines cross is an
 * artefact of the scaling and readers consistently read meaning into it.
 *
 * It is the right answer here, and the reference is right to ask for it,
 * because the two series are not independent measurements — clicks are the
 * INPUT and earnings the OUTPUT of the same funnel, and the entire question an
 * affiliate has is whether the second follows the first. Separating them onto
 * two cards makes the reader do that comparison from memory, which is the one
 * thing a chart exists to prevent.
 *
 * The standard mitigation is applied: each axis is drawn in its own series'
 * colour, so which scale belongs to which line is never a guess. The gridlines
 * belong to the LEFT axis only — a second set would imply a shared grid the
 * two scales do not have.
 *
 * Both series are gap-filled upstream, so a flat stretch here means nothing
 * happened rather than nothing was recorded.
 */

const W = 720
const H = 240
const PAD = { top: 14, right: 46, bottom: 26, left: 52 }

/** Rounds an axis maximum up to something a human would have chosen. */
function niceMax(n: number) {
  if (n <= 0) return 4
  const mag = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (n <= m * mag) return m * mag
  }
  return 10 * mag
}

/** `GHS 1,500` → `1.5k`. Axis labels have no room for a full cedi figure. */
function short(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return String(n)
}

export function PerformanceOverview({ series }: { series: PerformancePoint[] }) {
  const t = useTranslations('affiliate.chart')
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const view = useMemo(() => series, [series])
  const empty = view.length === 0 || view.every((d) => d.earned_minor === 0 && d.clicks === 0)

  const earnings = view.map((d) => d.earned_minor / 100)
  const clicks = view.map((d) => d.clicks)
  const maxE = niceMax(Math.max(...earnings, 0))
  const maxC = Math.max(4, Math.ceil(Math.max(...clicks, 0) / 4) * 4)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (plotW * i) / Math.max(view.length - 1, 1)
  const yE = (v: number) => PAD.top + plotH * (1 - v / maxE)
  const yC = (v: number) => PAD.top + plotH * (1 - v / maxC)

  const path = (values: number[], scale: (v: number) => number) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${scale(v).toFixed(1)}`).join(' ')

  /* Pointer → nearest index. Reading the band from the SVG's own box rather
     than from a stored width keeps the hit test correct after the card is
     resized, which a fixed viewBox otherwise hides. */
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || view.length === 0) return
    const box = svg.getBoundingClientRect()
    const ratio = ((event.clientX - box.left) / box.width) * W
    const i = Math.round(((ratio - PAD.left) / plotW) * (view.length - 1))
    setHover(Math.min(Math.max(i, 0), view.length - 1))
  }

  const point = hover === null ? null : view[hover]
  const gridlines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="px-4 pb-4">
      {/* Legend. Dots rather than line samples: at this size a 12px dash of a
          2px stroke is almost invisible on a dark field. */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2 text-[0.75rem] text-ink-500">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: 'var(--chart-series)' }}
          />
          {t('earnings')}
        </span>
        <span className="flex items-center gap-2 text-[0.75rem] text-ink-500">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: 'var(--chart-series-alt)' }}
          />
          {t('clicks')}
        </span>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-pan-y"
          role="img"
          aria-label={t('title')}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="aff-earn-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-series)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--chart-series)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid + left axis labels, in the earnings colour. Axis figures are
              suppressed when there is no data: an axis running 0–4 with nothing
              plotted against it is furniture around an empty room, and it
              collided with the empty-state sentence sitting in the middle. */}
          {gridlines.map((g) => {
            const y = PAD.top + plotH * g
            return (
              <g key={g}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-ink-200"
                />
                {!empty && (
                  <>
                    <text
                      x={PAD.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-current text-[11px]"
                      style={{ color: 'var(--chart-series)' }}
                    >
                      {short(Math.round(maxE * (1 - g)))}
                    </text>
                    {/* Right axis, in the clicks colour. */}
                    <text
                      x={W - PAD.right + 8}
                      y={y + 4}
                      textAnchor="start"
                      className="fill-current text-[11px]"
                      style={{ color: 'var(--chart-series-alt)' }}
                    >
                      {short(Math.round(maxC * (1 - g)))}
                    </text>
                  </>
                )}
              </g>
            )
          })}

          {!empty && (
            <>
              {/* Earnings: filled area under a line — it is a value that
                  accumulates, and the fill says so. Clicks get a bare line;
                  two fills would be mud. */}
              <path
                d={`${path(earnings, yE)} L${x(view.length - 1)},${PAD.top + plotH} L${x(0)},${PAD.top + plotH} Z`}
                fill="url(#aff-earn-fill)"
              />
              <path
                d={path(earnings, yE)}
                fill="none"
                stroke="var(--chart-series)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={path(clicks, yC)}
                fill="none"
                stroke="var(--chart-series-alt)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* Crosshair and the two markers. */}
          {hover !== null && !empty && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="currentColor"
                strokeWidth="1"
                className="text-ink-300"
              />
              <circle cx={x(hover)} cy={yE(earnings[hover])} r="4" fill="var(--chart-series)" />
              <circle cx={x(hover)} cy={yC(clicks[hover])} r="4" fill="var(--chart-series-alt)" />
            </g>
          )}
        </svg>

        {empty && (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-[0.8125rem] text-ink-500">
            {t('empty')}
          </p>
        )}

        {point && !empty && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-2 rounded-(--radius-input) border border-ink-200',
              'bg-surface px-2.5 py-2 text-[0.75rem] shadow-lg',
            )}
            style={{
              /* Clamped so the card never pushes the tooltip off its own edge
                 at either end of the series. */
              left: `${Math.min(Math.max((x(hover!) / W) * 100, 8), 82)}%`,
            }}
          >
            <p className="font-medium text-ink-500">{point.day}</p>
            <p className="mt-0.5 font-semibold tabular-nums text-ink-900">
              {cedis(point.earned_minor)}
            </p>
            <p className="tabular-nums text-ink-600">{t('clicksN', { n: point.clicks })}</p>
          </div>
        )}
      </div>

      {/*
        The same numbers, for anybody the SVG does not serve.

        ⚠️ `sr-only` goes on a DIV, not on the <table>. Put on the table itself
        it does not clip: the utility is `position:absolute; height:1px;
        overflow:hidden`, and a table establishes its own layout that escapes
        that box — measured at 768px of invisible page below the fold, which is
        why /market scrolled into empty space. A plain block container honours
        the overflow and the table inside it is genuinely 1px.
      */}
      <div className="sr-only">
      <table>
        <caption>{t('title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('date')}</th>
            <th scope="col">{t('earnings')}</th>
            <th scope="col">{t('clicks')}</th>
          </tr>
        </thead>
        <tbody>
          {view.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{cedis(d.earned_minor)}</td>
              <td>{d.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
