'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { recheckWithHub } from '@/app/[locale]/admin/(super)/payments/actions'
import { EmptyState, TableShell, Th } from '@/components/admin/AdminTable'
import { PersonCell, StatusPill } from '@/components/admin/AdminChrome'
import type { HubFlag, HubPayment } from '@/lib/admin/data/hub-payments'
import { cn } from '@/lib/cn'

/**
 * What the payment hub has done to this app's money.
 *
 * ⚠️ THE FLAGGED LIST IS FIRST, AND IT IS NOT A FILTER OF THE TABLE BELOW.
 * Some of those events have no payment at all: an unknown reference is one the
 * hub delivered that this app has never held, so there is no row to attach it
 * to and no amount of scrolling through payments would reveal it. Money moved
 * at the provider and did not move here. If it is ever non-empty, it is the
 * only thing on this screen worth reading.
 *
 * The payments table follows the house pattern: `TableShell` from `lg` up, a
 * card list below it. Both are required. `TableShell` is `hidden ... lg:block`,
 * so a screen with only a table is a blank page on a phone.
 */

const RESULT_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  confirmed: 'success',
  already_done: 'neutral',
  failed: 'neutral',
  reversed: 'warning',
  mismatch: 'danger',
  error: 'danger',
  unknown_reference: 'warning',
  received: 'warning',
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  confirmed: 'success',
  pending: 'warning',
  failed: 'neutral',
  refunded: 'danger',
}

export function HubPaymentsTable({
  payments,
  flags,
}: {
  payments: HubPayment[]
  flags: HubFlag[]
}) {
  const t = useTranslations('admin.payments')
  const format = useFormatter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const money = (minor: number | null, currency: string | null) =>
    minor === null ? '—' : `${currency ?? 'GHS'} ${(minor / 100).toFixed(2)}`

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const recheck = (reference: string) => {
    setNote(null)
    setBusy(reference)
    startTransition(async () => {
      const result = await recheckWithHub(reference)
      setBusy(null)
      setNote(
        result.ok
          ? result.unreachable
            ? t('recheck.unreachable')
            : t('recheck.done', { state: t(`state.${result.state}`) })
          : result.message,
      )
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {note && (
        <p role="status" className="text-[0.8125rem] font-medium text-ink-600">
          {note}
        </p>
      )}

      {/* ---- Needs attention ------------------------------------------- */}
      {flags.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-danger-700">
            <AlertTriangle aria-hidden className="size-4" />
            {t('flags.title', { count: flags.length })}
          </h2>
          <p className="max-w-[62ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('flags.description')}
          </p>

          <ul className="flex flex-col gap-2">
            {flags.map((flag) => (
              <li
                key={flag.id}
                className="rounded-(--radius-card) border border-danger-500/25 bg-danger-50/40 p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={RESULT_TONE[flag.result] ?? 'danger'}>
                    {t(`result.${flag.result}`)}
                  </StatusPill>
                  <span className="font-mono text-[0.8125rem] text-ink-700">{flag.reference}</span>
                  <span className="text-[0.8125rem] text-ink-500">
                    {money(flag.amountMinor, flag.currency)}
                  </span>
                  <span className="ml-auto text-[0.75rem] text-ink-400">{when(flag.receivedAt)}</span>
                </div>
                {flag.detail && (
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{flag.detail}</p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  {flag.person && <span className="text-[0.75rem] text-ink-500">{flag.person}</span>}
                  <button
                    type="button"
                    onClick={() => recheck(flag.reference)}
                    disabled={pending && busy === flag.reference}
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[0.75rem] font-medium',
                      'text-brand-700 underline-offset-2 hover:underline disabled:opacity-50',
                    )}
                  >
                    <RefreshCw aria-hidden className="size-3.5" />
                    {t('recheck.action')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {payments.length === 0 && <EmptyState>{t('empty')}</EmptyState>}

      {/* ---- Payments, lg and up --------------------------------------- */}
      {payments.length > 0 && (
        <TableShell>
          <thead>
            <tr className="border-b border-ink-200">
              <Th>{t('columns.person')}</Th>
              <Th>{t('columns.plan')}</Th>
              <Th align="right">{t('columns.amount')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th>{t('columns.lastEvent')}</Th>
              <Th align="right">{t('columns.started')}</Th>
              <Th align="right" srOnly>
                {t('columns.actions')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-ink-100 last:border-0">
                <td className="px-4 py-3">
                  <PersonCell name={p.person} secondary={p.reference} size="md" />
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-ink-700">{p.tierName}</td>
                <td className="px-4 py-3 text-right text-[0.8125rem] font-medium text-ink-800">
                  {money(p.amountMinor, p.currency)}
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={STATUS_TONE[p.status] ?? 'neutral'}>
                    {t(`status.${p.status}`)}
                  </StatusPill>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-ink-600">
                  {p.lastResult ? (
                    <span className="flex items-center gap-2">
                      <StatusPill tone={RESULT_TONE[p.lastResult] ?? 'neutral'}>
                        {t(`result.${p.lastResult}`)}
                      </StatusPill>
                      {p.eventCount > 1 && (
                        <span className="text-[0.75rem] text-ink-400">
                          {t('eventCount', { count: p.eventCount })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-400">{t('noEvents')}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-[0.75rem] whitespace-nowrap text-ink-500">
                  {when(p.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => recheck(p.reference)}
                    disabled={pending && busy === p.reference}
                    aria-label={t('recheck.rowLabel', { reference: p.reference })}
                    className="inline-flex size-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:opacity-40"
                  >
                    <RefreshCw aria-hidden className={cn('size-4', busy === p.reference && 'animate-spin')} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {/* ---- Payments, below lg ---------------------------------------- */}
      {payments.length > 0 && (
        <ul className="flex flex-col gap-2 lg:hidden">
          {payments.map((p) => (
            <li key={p.id} className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <PersonCell name={p.person} secondary={p.reference} size="md" />
                <StatusPill tone={STATUS_TONE[p.status] ?? 'neutral'}>
                  {t(`status.${p.status}`)}
                </StatusPill>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-600">
                <span className="font-medium text-ink-800">{money(p.amountMinor, p.currency)}</span>
                <span>{p.tierName}</span>
                <span className="text-[0.75rem] text-ink-400">{when(p.createdAt)}</span>
              </div>

              {p.lastResult && (
                <div className="mt-2 flex items-center gap-2">
                  <StatusPill tone={RESULT_TONE[p.lastResult] ?? 'neutral'}>
                    {t(`result.${p.lastResult}`)}
                  </StatusPill>
                  {p.lastDetail && (
                    <span className="text-[0.75rem] text-ink-500">{p.lastDetail}</span>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => recheck(p.reference)}
                disabled={pending && busy === p.reference}
                className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700 underline-offset-2 hover:underline disabled:opacity-50"
              >
                <RefreshCw aria-hidden className={cn('size-3.5', busy === p.reference && 'animate-spin')} />
                {t('recheck.action')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
