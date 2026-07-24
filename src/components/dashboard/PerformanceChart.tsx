'use client'

import { useMemo, useRef, useState } from 'react'

import { useFormatter, useTranslations } from 'next-intl'

import type { DailyPoint } from '@/lib/dashboard/home-data'
import { cn } from '@/lib/cn'

/**
 * Earnings / ads-watched performance, tablet and desktop only (operator
 * decision 2026-07-24 — mobile gets no chart, so this card is `hidden
 * md:block` at the call site).
 *
 * One card, one series at a time, toggled — never two y-scales on one plot.
 * Earnings is change-over-time → area with a 2px line; ads watched is a
 * daily count → bars with rounded data-ends and a 2px surface gap. The
 * series hue is `--chart-series`, validated against both surfaces with the
 * dataviz palette checks. Grid and axis text stay recessive (hairline +
 * muted ink) so the data is the loudest thing on the card.
 *
 * Hover: crosshair + tooltip (area), per-bar tooltip (bars). A visually
 * hidden table mirrors the data for screen readers.
 */

type Metric = 'earned' | 'adsWatched'
type Period = 7 | 30

const W = 720
const H = 220
const PAD = { top: 12, right: 28, bottom: 24, left: 44 }

function niceMax(n: number) {
  if (n <= 0) return 4
  const mag = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (n <= m * mag) return m * mag
  }
  return 10 * mag
}

export function PerformanceChart({ daily }: { daily: DailyPoint[] }) {
  const t = useTranslations('dashboard.chart')
  const format = useFormatter()

  const [metric, setMetric] = useState<Metric>('earned')
  const [period, setPeriod] = useState<Period>(7)
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const view = useMemo(() => daily.slice(-period), [daily, period])
  const values = view.map((d) => d[metric])
  // Counts get an integer axis: snap the max to a multiple of 4 so the four
  // gridlines land on whole ads — 2.5 ads watched is not a thing.
  const max =
    metric === 'adsWatched'
      ? Math.max(4, Math.ceil(Math.max(...values) / 4) * 4)
      : niceMax(Math.max(...values))
  const empty = values.every((v) => v === 0)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (plotW * i) / Math.max(view.length - 1, 1)
  const y = (v: number) => PAD.top + plotH * (1 - v / max)

  // Bars need a band, not a point scale. Width is capped: at 7 points the
  // band is ~90px and an uncapped bar becomes a slab, not a mark.
  const band = plotW / view.length
  const barW = Math.min(Math.max(band - 2, 3), 40) // 2px surface gap, thin marks
  const barX = (i: number) => PAD.left + band * i + (band - barW) / 2

  const linePath = view
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[metric]).toFixed(1)}`)
    .join('')
  const areaPath = `${linePath}L${x(view.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)}L${PAD.left},${(PAD.top + plotH).toFixed(1)}Z`

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => ({
    yPos: PAD.top + plotH * (1 - f),
    label: max * f,
  }))

  // Sparse x ticks: first, middle, last — dates, muted.
  const tickIdx =
    view.length <= 7
      ? view.map((_, i) => i)
      : [0, Math.floor(view.length / 2), view.length - 1]

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.left) / plotW) * (view.length - 1))
    setHover(Math.min(Math.max(i, 0), view.length - 1))
  }

  const day = (iso: string) =>
    format.dateTime(new Date(iso + 'T00:00:00Z'), { month: 'short', day: 'numeric' })

  const hovered = hover !== null ? view[hover] : null

  // Each metric owns a hue (earnings blue, ads violet), both steps validated
  // per surface — see --chart-series/--chart-series-alt in globals.css.
  const series = metric === 'earned' ? 'var(--chart-series)' : 'var(--chart-series-alt)'

  return (
    <div className="p-4">
      {/* Controls: one row above the plot. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t('metricLabel')} className="flex gap-1 rounded-(--radius-input) bg-ink-100 p-0.5">
          {(['earned', 'adsWatched'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={metric === m}
              onClick={() => { setMetric(m); setHover(null) }}
              className={cn(
                'flex items-center gap-1.5 rounded-[0.4375rem] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                metric === m
                  ? 'bg-surface text-ink-900 shadow-[0_1px_2px_rgb(15_23_42/0.06)]'
                  : 'text-ink-500 hover:text-ink-700',
              )}
            >
              {/* Series dot ties the tab to the mark colour on the plot. */}
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  background:
                    m === 'earned' ? 'var(--chart-series)' : 'var(--chart-series-alt)',
                  opacity: metric === m ? 1 : 0.45,
                }}
              />
              {t(m)}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {([7, 30] as const).map((p) => (
            <button
              key={p}
              aria-pressed={period === p}
              onClick={() => { setPeriod(p); setHover(null) }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[0.75rem] font-medium transition-colors',
                period === p
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-700',
              )}
            >
              {t('days', { count: p })}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t(metric)}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Recessive grid: hairlines + muted labels, never louder than data. */}
          {gridLines.map((g) => (
            <g key={g.yPos}>
              <line x1={PAD.left} x2={W - PAD.right} y1={g.yPos} y2={g.yPos} className="stroke-ink-200" strokeWidth="1" strokeDasharray="0" />
              <text x={PAD.left - 8} y={g.yPos + 3.5} textAnchor="end" className="fill-ink-400 text-[10px] tabular-nums">
                {format.number(g.label, { notation: 'compact' })}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stroke-ink-300" strokeWidth="1" />

          {tickIdx.map((i) => (
            <text key={i} x={metric === 'adsWatched' ? barX(i) + barW / 2 : x(i)} y={H - 6} textAnchor="middle" className="fill-ink-400 text-[10px]">
              {day(view[i].day)}
            </text>
          ))}

          {!empty && metric === 'earned' && (
            <>
              <path d={areaPath} fill={series} opacity="0.12" />
              <path d={linePath} fill="none" stroke={series} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hovered && (
                <>
                  <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-ink-300" strokeWidth="1" />
                  {/* ≥8px marker with a 2px surface ring. */}
                  <circle cx={x(hover!)} cy={y(hovered[metric])} r="4.5" fill={series} className="stroke-surface" strokeWidth="2" />
                </>
              )}
            </>
          )}

          {!empty && metric === 'adsWatched' && view.map((d, i) => {
            const top = y(d.adsWatched)
            const h = PAD.top + plotH - top
            if (h <= 0) return null
            const r = Math.min(4, barW / 2, h) // rounded data-end, baseline square
            return (
              <path
                key={d.day}
                d={`M${barX(i)},${PAD.top + plotH}V${top + r}Q${barX(i)},${top} ${barX(i) + r},${top}H${barX(i) + barW - r}Q${barX(i) + barW},${top} ${barX(i) + barW},${top + r}V${PAD.top + plotH}Z`}
                fill={series}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            )
          })}
        </svg>

        {empty && (
          <p className="absolute inset-0 grid place-items-center text-[0.8125rem] text-ink-400">
            {t('empty')}
          </p>
        )}

        {hovered && !empty && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-(--radius-input) border border-ink-200 bg-surface px-2.5 py-1.5 shadow-[0_4px_12px_-2px_rgb(15_23_42/0.12)]"
            style={{
              left: `${(((metric === 'adsWatched' ? barX(hover!) + barW / 2 : x(hover!)) / W) * 100).toFixed(2)}%`,
              top: 0,
            }}
          >
            <p className="whitespace-nowrap text-[0.6875rem] text-ink-400">{day(hovered.day)}</p>
            <p className="whitespace-nowrap text-[0.8125rem] font-semibold tabular-nums text-ink-900">
              {metric === 'earned'
                ? t('tooltipEarned', { points: format.number(hovered.earned) })
                : t('tooltipAds', { count: hovered.adsWatched })}
            </p>
          </div>
        )}
      </div>

      {/* Same data, readable without the plot. */}
      <table className="sr-only">
        <caption>{t(metric)}</caption>
        <thead>
          <tr><th>{t('dateColumn')}</th><th>{t(metric)}</th></tr>
        </thead>
        <tbody>
          {view.map((d) => (
            <tr key={d.day}><td>{d.day}</td><td>{d[metric]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
