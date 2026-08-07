'use client'

import { useEffect, useState, useTransition } from 'react'

import { AlertTriangle, Check, Copy, Gift, RefreshCw, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  createCommissionGiftCode,
  newCommissionCodeCandidate,
  revokeCommissionGiftCode,
} from '@/app/[locale]/admin/(super)/gift-codes/actions'
import { Button } from '@/components/ui/Button'
import type { CommissionGiftCodeRow } from '@/lib/admin/data/gift-codes'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'

/**
 * Gift codes for the AFFILIATE business. Cedis, not points.
 *
 * The operator went looking for these and found only the ads board
 * (2026-08-07): "the gift code that exist is just for the ads." Same three
 * jobs as that board — create one, see them all, revoke an unused one — and
 * deliberately the same shape, so an operator who has used one has used both.
 *
 * ⚠️ THE AMOUNT FIELD IS CEDIS AND THE COLUMN IS CEDIS, and that is the one
 * thing that must never blur. A points code and a commission code look
 * identical on screen: twelve characters, a status, a number. The number is
 * the difference, and 500 of one is worth a hundred times 500 of the other. So
 * the field carries the currency in its label, the value is typed in cedis and
 * converted to minor units once at the edge, and every figure in the list is
 * rendered through `cedis()` rather than `format.number`.
 *
 * The code field is read-only for the same reason as the ads board: the point
 * of generating is that an operator cannot pick something guessable, and a
 * field they could edit hands that straight back.
 */
export function CommissionGiftCodesBoard({ codes }: { codes: CommissionGiftCodeRow[] }) {
  const t = useTranslations('admin.commissionGiftCodes')

  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-3"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-700" />
          <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-danger-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 text-danger-700/70 hover:text-danger-700"
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">{t('dismiss')}</span>
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-500">{t('intro')}</p>
        <Button size="md" leadingIcon={<Gift />} onClick={() => setOpen(true)}>
          {t('create')}
        </Button>
      </div>

      {open && <CreateForm onClose={() => setOpen(false)} onError={setError} />}

      {codes.length === 0 ? (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.875rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <CodeList codes={codes} onError={setError} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function CreateForm({
  onClose,
  onError,
}: {
  onClose: () => void
  onError: (m: string | null) => void
}) {
  const t = useTranslations('admin.commissionGiftCodes')

  const [code, setCode] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [regenerating, startRegenerate] = useTransition()

  useEffect(() => {
    let cancelled = false
    void newCommissionCodeCandidate().then((r) => {
      if (cancelled) return
      if (r.ok) setCode(r.data)
      else onError(r.message)
    })
    return () => {
      cancelled = true
    }
  }, [onError])

  const regenerate = () =>
    startRegenerate(async () => {
      const r = await newCommissionCodeCandidate()
      if (r.ok) setCode(r.data)
      else onError(r.message)
    })

  /* Typed in cedis, converted here and only here. Every figure below this line
     is minor units, which is what the column and the ledger both hold. */
  const value = Number(amount)
  const amountMinor = Number.isFinite(value) ? Math.round(value * 100) : 0
  const ready = code !== null && amountMinor > 0 && !pending

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || !code) return
    onError(null)
    startTransition(async () => {
      const r = await createCommissionGiftCode({
        code,
        amountMinor,
        note: note.trim() || undefined,
      })
      if (!r.ok) return onError(r.message)
      onClose()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="animate-rise mb-5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-[0.8125rem] font-medium text-ink-700">{t('form.code')}</span>
          <div className="mt-1.5 flex items-center gap-2">
            <output
              className={cn(
                'h-11 flex-1 rounded-(--radius-input) border border-ink-200 bg-ink-50/60 px-3',
                'grid place-items-center font-mono text-[0.9375rem] tabular-nums tracking-[0.18em] text-ink-900',
              )}
            >
              {code ?? t('form.generating')}
            </output>
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              title={t('form.regenerate')}
              className="grid size-11 shrink-0 place-items-center rounded-(--radius-input) border border-ink-200 text-ink-500 hover:border-ink-300 hover:text-ink-700 disabled:opacity-50"
            >
              <RefreshCw aria-hidden className={cn('size-4', regenerating && 'animate-spin')} />
              <span className="sr-only">{t('form.regenerate')}</span>
            </button>
          </div>
          <p className="mt-1.5 text-[0.75rem] text-ink-400">{t('form.codeHint')}</p>
        </div>

        <div>
          <label htmlFor="cgc-amount" className="text-[0.8125rem] font-medium text-ink-700">
            {t('form.amount')}
          </label>
          <input
            id="cgc-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            autoFocus
            placeholder="50.00"
            className="mt-1.5 h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-[0.9375rem] tabular-nums text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 focus:outline-none"
          />
          <p className="mt-1.5 text-[0.75rem] text-ink-400">
            {amountMinor > 0 ? t('form.worth', { amount: cedis(amountMinor) }) : t('form.amountHint')}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="cgc-note" className="text-[0.8125rem] font-medium text-ink-700">
          {t('form.note')}
        </label>
        <input
          id="cgc-note"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder={t('form.notePlaceholder')}
          className="mt-1.5 h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-[0.9375rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 focus:outline-none"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button type="submit" size="md" loading={pending} disabled={!ready}>
          {t('form.save')}
        </Button>
        <Button type="button" size="md" variant="ghost" onClick={onClose}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */

function CodeList({
  codes,
  onError,
}: {
  codes: CommissionGiftCodeRow[]
  onError: (m: string | null) => void
}) {
  const t = useTranslations('admin.commissionGiftCodes')
  const format = useFormatter()
  const [busy, startTransition] = useTransition()
  const [copied, setCopied] = useState<string | null>(null)

  const revoke = (id: string) => {
    onError(null)
    startTransition(async () => {
      const r = await revokeCommissionGiftCode(id)
      if (!r.ok) onError(r.message)
    })
  }

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* Clipboard blocked. The code is on screen and selectable. */
    }
  }

  const tone = (s: CommissionGiftCodeRow['status']) =>
    s === 'active' ? 'success' : s === 'redeemed' ? 'neutral' : 'danger'

  return (
    <>
      {/* ⚠️ Cards below lg AND a table at lg+. A screen with only the table is
          a blank screen on a phone — see the note on TableShell. */}
      <ul className="flex flex-col gap-2.5 lg:hidden">
        {codes.map((c) => (
          <li key={c.id} className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => copy(c.code)}
                className="flex items-center gap-1.5 font-mono text-[0.9375rem] tracking-[0.14em] text-ink-900"
              >
                {c.code}
                {copied === c.code ? (
                  <Check aria-hidden className="size-3.5 text-success-600" />
                ) : (
                  <Copy aria-hidden className="size-3.5 text-ink-400" />
                )}
              </button>
              <StatusDot tone={tone(c.status)}>{t(`status.${c.status}`)}</StatusDot>
            </div>
            <p className="mt-2 text-[0.8125rem] font-semibold tabular-nums text-ink-900">
              {cedis(c.amountMinor)}
            </p>
            {c.note && <p className="mt-1 text-[0.75rem] text-ink-500">{c.note}</p>}
            <p className="mt-1 text-[0.75rem] text-ink-400">
              {c.redeemedByName
                ? t('redeemedBy', { name: c.redeemedByName })
                : t('createdOn', {
                    when: format.dateTime(new Date(c.createdAt), {
                      day: 'numeric',
                      month: 'short',
                    }),
                  })}
            </p>
            {c.status === 'active' && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => revoke(c.id)}
                className="mt-2.5 text-danger-700 hover:bg-danger-50"
              >
                {t('revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 lg:block">
        <table className="w-full">
          <thead className="bg-ink-50/60">
            <tr className="text-left text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-ink-500">
              <th className="px-4 py-2.5">{t('col.code')}</th>
              <th className="px-4 py-2.5 text-right">{t('col.amount')}</th>
              <th className="px-4 py-2.5">{t('col.status')}</th>
              <th className="px-4 py-2.5">{t('col.note')}</th>
              <th className="px-4 py-2.5">{t('col.redeemed')}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {codes.map((c) => (
              <tr key={c.id} className="text-[0.8125rem]">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => copy(c.code)}
                    className="flex items-center gap-1.5 font-mono tracking-[0.12em] text-ink-900"
                  >
                    {c.code}
                    {copied === c.code ? (
                      <Check aria-hidden className="size-3.5 text-success-600" />
                    ) : (
                      <Copy aria-hidden className="size-3.5 text-ink-400" />
                    )}
                  </button>
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink-900">
                  {cedis(c.amountMinor)}
                </td>
                <td className="px-4 py-3">
                  <StatusDot tone={tone(c.status)}>{t(`status.${c.status}`)}</StatusDot>
                </td>
                <td className="max-w-[16rem] truncate px-4 py-3 text-ink-500">
                  {c.note ?? t('none')}
                </td>
                <td className="px-4 py-3 text-ink-500">{c.redeemedByName ?? t('none')}</td>
                <td className="px-4 py-3 text-right">
                  {c.status === 'active' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => revoke(c.id)}
                      className="text-[0.8125rem] font-medium text-danger-700 hover:underline disabled:opacity-50"
                    >
                      {t('revoke')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
