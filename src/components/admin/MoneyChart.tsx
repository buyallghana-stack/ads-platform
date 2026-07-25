'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import type { DailyMoney } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

/**
 * Money in against money out, as grouped bars (reference 1).
 *
 * Hand-rolled SVG, like the user dashboard's chart, so there is no charting
 * dependency shipped to a phone on a Ghanaian connection — and this one is
 * never shipped to a phone at all: the operator asked for no charts on
 * mobile, so the parent renders it from md up only.
 *
 * Two series share one axis here, unlike the user chart where the two are
 * toggled. That is deliberate and it is the whole point of the card: deposits
 * and withdrawals are the same unit (cedis) and the gap between them IS the
 * profit, so showing them apart would hide the one relationship that matters.
 *
 * Colours follow the platform's fixed meanings: success green for money in,
 * brand blue for money out. Neither is "bad" — a withdrawal is the product
 * working — so red is deliberately not used.
 */

const W = 760
const H = 240
const PAD = { top: 16, right: 12, bottom: 26, left: 44 }

const RANGES = [7, 30] as const
type Range = (typeof RANGES)[number]

function niceMax(n: number) {
  if (n <= 0) return 100
  const magnitude = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / magnitude) * magnitude
}

export function MoneyChart({ data }: { data: DailyMoney[] }) {
  const t = useTranslations('admin.overview.chart')
  const [range, setRange] = useState<Range>(30)

  const view = useMemo(() => data.slice(-range), [data, range])

  const max = useMemo(
    () => niceMax(Math.max(...view.flatMap((d) => [d.deposits, d.withdrawals]), 1)),
    [view],
  )

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const band = plotW / Math.max(view.length, 1)
  // Two bars per day inside the band, with a gap. Capped so a 7-day view does
  // not turn into slabs.
  const barW = Math.min(Math.max(band / 2 - 2, 2), 14)

  const y = (v: number) => PAD.top + plotH * (1 - v / max)
  const bandX = (i: number) => PAD.left + band * i

  const gridlines = [0, 0.25, 0.5, 0.75, 1]

  const totals = useMemo(
    () => ({
      deposits: view.reduce((s, d) => s + d.deposits, 0),
      withdrawals: view.reduce((s, d) => s + d.withdrawals, 0),
    }),
    [view],
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink-900">{t('title')}</h2>
          <p className="mt-0.5 text-[0.75rem] text-ink-500">
            {t('subtitle', {
              in: totals.deposits.toLocaleString(),
              out: totals.withdrawals.toLocaleString(),
            })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-600">
            <span aria-hidden className="size-2 rounded-[2px] bg-success-600" />
            {t('deposits')}
          </span>
          <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-600">
            <span aria-hidden className="size-2 rounded-[2px] bg-brand-600" />
            {t('withdrawals')}
          </span>

          <div className="flex gap-1 rounded-(--radius-input) bg-ink-100 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-[calc(var(--radius-input)-0.25rem)] px-2 py-1 text-[0.6875rem] font-semibold transition-colors',
                  range === r ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]' : 'text-ink-500',
                )}
              >
                {t('days', { count: r })}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-2 py-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[240px] w-full"
          role="img"
          aria-label={t('title')}
        >
          {gridlines.map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(max * f)}
                y2={y(max * f)}
                className="stroke-ink-200"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(max * f) + 3}
                textAnchor="end"
                className="fill-ink-400 text-[9px] tabular-nums"
              >
                {Math.round(max * f).toLocaleString()}
              </text>
            </g>
          ))}

          {view.map((d, i) => {
            const x = bandX(i) + (band - barW * 2 - 2) / 2
            return (
              <g key={d.day}>
                <rect
                  x={x}
                  y={y(d.deposits)}
                  width={barW}
                  height={Math.max(plotH - (y(d.deposits) - PAD.top), 1)}
                  rx={2}
                  className="fill-success-600"
                />
                <rect
                  x={x + barW + 2}
                  y={y(d.withdrawals)}
                  width={barW}
                  height={Math.max(plotH - (y(d.withdrawals) - PAD.top), 1)}
                  rx={2}
                  className="fill-brand-600"
                />
              </g>
            )
          })}

          {/* Only a few date labels: at 30 days every one would collide. */}
          {view.map((d, i) => {
            const every = Math.ceil(view.length / 7)
            if (i % every !== 0) return null
            return (
              <text
                key={d.day}
                x={bandX(i) + band / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-ink-400 text-[9px]"
              >
                {d.day.slice(8)}/{d.day.slice(5, 7)}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
