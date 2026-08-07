'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, Check, GraduationCap, Pencil } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { saveCommissionAction } from '@/app/[locale]/admin/(super)/catalogue/actions'
import { Link } from '@/i18n/navigation'
import type { CatalogueRow } from '@/lib/admin/catalogue-data'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'

/**
 * The training programmes and what they pay.
 *
 * ── THE COMMISSION IS EDITED HERE, IN PLACE ──
 *
 * It is the same `admin_save_affiliate_program` the product editor calls, and
 * deliberately so: one write path, one set of constraints, no second opinion
 * about what a rate is. What changes is where the operator finds it. Training
 * commission is what recruiting an affiliate pays, and it is the number they
 * will want to move most often — three clicks into a product editor is where a
 * number goes to be forgotten.
 *
 * ⚠️ The cash line is not decoration. 20% of GHS 350 is GHS 70 and 5% is GHS
 * 17.50, and those are the figures an affiliate sees on their own screen. A
 * percent field alone has repeatedly let this platform set a number nobody
 * had converted.
 */
export function TrainingBoard({ rows }: { rows: CatalogueRow[] }) {
  const t = useTranslations('admin.training')

  if (rows.length === 0) {
    return (
      <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.875rem] text-ink-400">
        {t('empty')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <ProgrammeCard key={row.id} row={row} />
      ))}
    </div>
  )
}

function ProgrammeCard({ row }: { row: CatalogueRow }) {
  const t = useTranslations('admin.training')
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [l1, setL1] = useState(row.l1_rate === null ? '' : String(row.l1_rate))
  const [l2, setL2] = useState(row.l2_rate === null ? '' : String(row.l2_rate))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const price = row.effective_price_ghs
  const n1 = Number(l1)
  const n2 = Number(l2)
  const valid = Number.isFinite(n1) && Number.isFinite(n2) && n1 >= 0 && n2 >= 0 && n1 + n2 <= 100
  const money = (percent: number) => `GHS ${((price * percent) / 100).toFixed(2)}`

  const save = () => {
    setError(null)
    start(async () => {
      const result = await saveCommissionAction({
        productId: row.id,
        l1: n1,
        l2: n2,
        windowHours: row.attribution_window_hours ?? 720,
        holdDays: row.hold_days ?? 0,
        active: row.commission_status !== 'paused',
      })
      if (!result.ok) return setError(result.message)
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-500/12 text-violet-600"
          >
            <GraduationCap className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[1rem] font-semibold text-ink-900">{row.title}</h2>
            <p className="mt-0.5 text-[0.75rem] text-ink-500">
              {t('priceLine', { price: `GHS ${price.toFixed(2)}`, lessons: row.lessons })}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusDot tone={row.status === 'published' ? 'success' : 'neutral'}>
            {t(`status.${row.status}`)}
          </StatusDot>
          <Link
            href={`/admin/catalogue/${row.id}`}
            className="inline-flex items-center gap-1.5 rounded-(--radius-input) border border-ink-200 px-3 py-1.5 text-[0.8125rem] font-medium text-ink-700 transition-colors hover:border-ink-300"
          >
            <Pencil aria-hidden className="size-3.5" />
            {t('edit')}
          </Link>
        </div>
      </div>

      {/* ── what it pays ─────────────────────────────────────────────── */}
      <div className="mt-4 rounded-(--radius-card) border border-ink-200 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.8125rem] font-semibold text-ink-900">{t('commission')}</p>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[0.8125rem] font-medium text-brand-700 hover:underline"
            >
              {row.l1_rate === null ? t('setRates') : t('changeRates')}
            </button>
          )}
        </div>

        {row.l1_rate === null && !editing && (
          <p className="mt-2 flex items-start gap-2 text-[0.8125rem] leading-snug text-warning-600">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('noRates')}
          </p>
        )}

        {!editing && row.l1_rate !== null && (
          <dl className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {[
              { k: t('levelOne'), pct: row.l1_rate, hint: t('levelOneHint') },
              { k: t('levelTwo'), pct: row.l2_rate ?? 0, hint: t('levelTwoHint') },
            ].map((cell) => (
              <div key={cell.k} className="rounded-(--radius-input) bg-ink-50 px-3 py-2.5">
                <dt className="text-[0.75rem] text-ink-500">{cell.k}</dt>
                <dd className="mt-0.5 text-[0.9375rem] font-semibold tabular-nums text-ink-900">
                  {cell.pct}% <span className="text-ink-500">·</span>{' '}
                  <span className="text-success-600">{money(cell.pct)}</span>
                </dd>
                <p className="mt-0.5 text-[0.6875rem] text-ink-500">{cell.hint}</p>
              </div>
            ))}
          </dl>
        )}

        {editing && (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                { id: 'l1', label: t('levelOne'), value: l1, set: setL1 },
                { id: 'l2', label: t('levelTwo'), value: l2, set: setL2 },
              ].map((f) => (
                <label key={f.id} className="block">
                  <span className="text-[0.8125rem] font-medium text-ink-700">{f.label}</span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      max="100"
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      className="h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3 text-[0.9375rem] tabular-nums text-ink-900 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 focus:outline-none"
                    />
                    <span className="shrink-0 text-[0.8125rem] text-ink-500">%</span>
                  </div>
                </label>
              ))}
            </div>

            {valid && price > 0 && (
              <p className="mt-3 rounded-(--radius-input) bg-ink-50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-ink-700">
                {t('preview', {
                  price: `GHS ${price.toFixed(2)}`,
                  seller: money(n1),
                  recruiter: money(n2),
                  kept: `GHS ${(price - (price * n1) / 100 - (price * n2) / 100).toFixed(2)}`,
                })}
              </p>
            )}
            {!valid && <p className="mt-2 text-[0.8125rem] text-danger-700">{t('over100')}</p>}
            {error && (
              <p className="mt-2 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700">
                {error}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending || !valid || l1 === ''}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-(--radius-input) bg-brand-600 px-4 py-2.5',
                  'text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-500',
                  'disabled:opacity-50',
                )}
              >
                <Check aria-hidden className="size-4" />
                {pending ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
                className="rounded-(--radius-input) border border-ink-200 px-4 py-2.5 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-ink-300"
              >
                {t('cancel')}
              </button>
            </div>
          </>
        )}

        <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-500">{t('frozenNote')}</p>
      </div>
    </section>
  )
}
