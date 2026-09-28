'use client'

import { useState, useTransition } from 'react'

import { Check, ImageOff, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { confirmManualPayment, rejectManualPayment } from '@/app/[locale]/admin/(super)/payments/actions'
import { Button } from '@/components/ui/Button'
import type { ManualPaymentRow } from '@/lib/admin/data/manual-payments'

/**
 * Manual mobile money waiting on the operator. One card per payment, the
 * screenshot beside what the buyer said, and a two-step decision so a stray
 * tap cannot grant or refuse a plan.
 */
export function ManualPaymentsQueue({ rows }: { rows: ManualPaymentRow[] }) {
  const t = useTranslations('admin.payments.manual')
  if (!rows.length) return null
  return (
    <section className="mb-8">
      <h2 className="text-[1rem] font-semibold text-ink-900">{t('title', { count: rows.length })}</h2>
      <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('description')}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.id} row={row} />
        ))}
      </div>
    </section>
  )
}

function Card({ row }: { row: ManualPaymentRow }) {
  const t = useTranslations('admin.payments.manual')
  const format = useFormatter()
  const [pending, startTransition] = useTransition()
  const [armed, setArmed] = useState<'confirm' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'confirmed' | 'rejected' | null>(null)

  const amount = format.number(row.amountMinor / 100, {
    style: 'currency',
    currency: row.currency,
    minimumFractionDigits: row.amountMinor % 100 ? 2 : 0,
  })

  const decide = (kind: 'confirm' | 'reject') => {
    if (armed !== kind) return setArmed(kind)
    setError(null)
    startTransition(async () => {
      const res = kind === 'confirm' ? await confirmManualPayment(row.id) : await rejectManualPayment(row.id)
      if (!res.ok) return setError(res.message)
      setDone(kind === 'confirm' ? 'confirmed' : 'rejected')
    })
  }

  return (
    <article className="flex gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-3.5">
      {row.proofUrl ? (
        <a href={row.proofUrl} target="_blank" rel="noreferrer" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring link */}
          <img
            src={row.proofUrl}
            alt={t('proofAlt')}
            className="h-36 w-24 rounded-(--radius-input) border border-ink-200 object-cover object-top"
          />
        </a>
      ) : (
        <div className="grid h-36 w-24 shrink-0 place-items-center rounded-(--radius-input) border border-dashed border-ink-300 text-center text-[0.6875rem] text-ink-400">
          <span>
            <ImageOff aria-hidden className="mx-auto mb-1 size-4" />
            {t('noProof')}
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[1.125rem] font-semibold text-ink-900 tabular-nums">{amount}</p>
          <p className="text-[0.75rem] font-medium text-ink-500 tabular-nums">{row.reference}</p>
        </div>
        <p className="text-[0.8125rem] text-ink-700">
          {row.planName} · {row.buyerName || t('unnamed')}
          {row.buyerPhone ? ` · ${row.buyerPhone}` : ''}
        </p>
        <dl className="mt-1.5 space-y-0.5 text-[0.75rem] text-ink-600">
          <div>
            <dt className="inline text-ink-500">{t('sentFrom')} </dt>
            <dd className="inline font-medium">
              {row.senderName ? `${row.senderName} (${row.senderPhone})` : t('notClaimed')}
            </dd>
          </div>
          <div>
            <dt className="inline text-ink-500">{t('when')} </dt>
            <dd className="inline">
              {format.dateTime(new Date(row.claimedAt ?? row.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </dd>
          </div>
        </dl>

        {done ? (
          <p className={`mt-2.5 text-[0.8125rem] font-medium ${done === 'confirmed' ? 'text-success-700' : 'text-danger-600'}`}>
            {t(done)}
          </p>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              size="sm"
              leadingIcon={<Check />}
              loading={pending && armed === 'confirm'}
              disabled={pending}
              onClick={() => decide('confirm')}
            >
              {armed === 'confirm' ? t('confirmSure', { amount }) : t('confirm')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<X />}
              loading={pending && armed === 'reject'}
              disabled={pending}
              onClick={() => decide('reject')}
            >
              {armed === 'reject' ? t('rejectSure') : t('reject')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-[0.75rem] font-medium text-danger-600">
            {error}
          </p>
        )}
      </div>
    </article>
  )
}
