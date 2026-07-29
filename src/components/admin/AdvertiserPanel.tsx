'use client'

import { useEffect, useState, useTransition } from 'react'

import { Plus, Trash2 } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  deleteAdvertiserPayment,
  loadAdvertiserPayments,
  recordAdvertiserPayment,
  saveAdvertiser,
  type AdvertiserInput,
} from '@/app/[locale]/admin/advertisers/actions'
import { Button } from '@/components/ui/Button'
import type { Advertiser, AdvertiserPayment } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'
import { Field, FieldSet, Segmented, inputClass } from './FormBits'

/**
 * One advertiser: what they agreed, what they have paid, what has been served
 * against it, and the two writes that change any of those.
 *
 * WHY THE RECEIPTS ARE HERE AND NOT ON THE ROW
 * The row answers "does this contract need looking at" — nearly spent, nearly
 * expired. The panel answers "why is the figure what it is", and for money
 * that means the individual payments with their bank references, because a
 * total nobody can trace back to a statement is a total nobody can defend.
 *
 * They are fetched WHEN THE PANEL OPENS rather than shipped with every row.
 * Most advertisers are never opened, and a list screen has no business
 * carrying every bank reference in the business in its payload.
 *
 * The delete on each receipt is deliberate. A mis-keyed amount that cannot be
 * removed would sit in the deposits figure and the monthly statement for
 * ever, and the database refuses negative payments precisely so that
 * "correcting" one cannot be done by burying an offsetting row in the list.
 */

type Mode = 'view' | 'edit' | 'pay'

export function AdvertiserPanel({
  advertiser,
  onClose,
  onChanged,
  onError,
}: {
  advertiser: Advertiser | null
  onClose: () => void
  onChanged: (advertisers?: Advertiser[]) => void
  onError: (message: string) => void
}) {
  if (!advertiser) return null
  /* Keyed, so opening a different advertiser mounts a fresh panel rather than
     carrying a half-typed payment across to the wrong contract. */
  return (
    <Panel
      key={advertiser.id}
      advertiser={advertiser}
      onClose={onClose}
      onChanged={onChanged}
      onError={onError}
    />
  )
}

function Panel({
  advertiser: a,
  onClose,
  onChanged,
  onError,
}: {
  advertiser: Advertiser
  onClose: () => void
  onChanged: (advertisers?: Advertiser[]) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.advertisers')
  const format = useFormatter()

  const [mode, setMode] = useState<Mode>('view')
  const [payments, setPayments] = useState<AdvertiserPayment[] | null>(null)
  const [busy, startTransition] = useTransition()

  /* Loading the receipts is a read of something already on screen in summary,
     so a failure here is not worth an error banner over the whole board — the
     section says it could not load them and the rest of the panel still
     works. */
  useEffect(() => {
    let live = true
    loadAdvertiserPayments(a.id).then((rows) => {
      if (live) setPayments(rows ?? [])
    })
    return () => {
      live = false
    }
  }, [a.id])

  const ghs = (n: number) =>
    `GHS ${format.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  const removePayment = (paymentId: string) => {
    startTransition(async () => {
      const result = await deleteAdvertiserPayment(paymentId, a.id)
      if (!result.ok) return onError(result.message)
      if (result.payments) setPayments(result.payments)
      onChanged(result.advertisers)
    })
  }

  const remaining = a.contractGhs - a.spentGhs

  return (
    <DetailPanel
      title={t('panel.title', { name: a.name })}
      closeLabel={t('panel.close')}
      onClose={() => (mode === 'view' ? onClose() : setMode('view'))}
      header={
        <div className="flex items-center gap-2.5">
          <StatusDot tone={a.status === 'active' ? 'success' : a.status === 'pending' ? 'warning' : 'neutral'}>
            {t(`status.${a.status}`)}
          </StatusDot>
          <span className="text-[0.75rem] text-ink-400">
            {t('panel.adsLive', { live: a.adsLive, total: a.adsTotal })}
          </span>
        </div>
      }
      footer={
        <PanelFooter raised={mode !== 'view'}>
          {mode === 'pay' ? (
            <PaymentForm
              advertiserId={a.id}
              busy={busy}
              onCancel={() => setMode('view')}
              onDone={(rows, advertisers) => {
                if (rows) setPayments(rows)
                onChanged(advertisers)
                setMode('view')
              }}
              onError={onError}
            />
          ) : mode === 'edit' ? (
            <ContractForm
              advertiser={a}
              busy={busy}
              onCancel={() => setMode('view')}
              onDone={(advertisers) => {
                onChanged(advertisers)
                setMode('view')
              }}
              onError={onError}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="md"
                variant="primary"
                className="flex-1"
                onClick={() => setMode('pay')}
              >
                <Plus aria-hidden className="size-4" />
                {t('panel.recordPayment')}
              </Button>
              <Button type="button" size="md" variant="secondary" onClick={() => setMode('edit')}>
                {t('panel.edit')}
              </Button>
            </div>
          )}
        </PanelFooter>
      }
    >
      <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">
        {ghs(a.contractGhs)}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-ink-500">
        {t('panel.paidHint', { count: a.payments })}
      </p>

      <PanelSection label={t('panel.delivery')}>
        <PanelFacts>
          <Fact label={t('panel.delivered')} value={ghs(a.spentGhs)} />
          {/* Negative is not an error and must not be hidden: it means more
              has been served than the advertiser has paid for, which is the
              single most expensive thing this screen can tell an operator. */}
          <Fact
            label={t('panel.remaining')}
            value={
              <span className={cn(remaining < 0 && 'font-semibold text-danger-700')}>
                {ghs(remaining)}
              </span>
            }
          />
          <Fact label={t('panel.adsLiveLabel')} value={a.adsLive.toLocaleString()} />
          <Fact label={t('panel.adsTotalLabel')} value={a.adsTotal.toLocaleString()} />
        </PanelFacts>
        {remaining < 0 && (
          <p className="mt-2.5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2 text-[0.75rem] leading-relaxed text-danger-700">
            {t('panel.overdelivered')}
          </p>
        )}
      </PanelSection>

      <PanelSection label={t('panel.contract')}>
        <PanelFacts>
          <Fact label={t('panel.contact')} value={a.contact || '—'} />
          <Fact label={t('panel.started')} value={date(a.startedAt)} />
          <Fact label={t('panel.ends')} value={a.endsAt ? date(a.endsAt) : t('noEnd')} />
          <Fact
            label={t('panel.lastPaid')}
            value={a.lastPaidAt ? date(a.lastPaidAt) : t('panel.neverPaid')}
          />
        </PanelFacts>
        {a.notes && (
          <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-600">{a.notes}</p>
        )}
      </PanelSection>

      <PanelSection label={t('panel.receipts')}>
        {payments === null ? (
          <p className="text-[0.8125rem] text-ink-400">{t('panel.loading')}</p>
        ) : payments.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-400">{t('panel.noReceipts')}</p>
        ) : (
          <ul className="divide-y divide-ink-200">
            {payments.map((p) => (
              <li key={p.id} className="flex items-start gap-2 py-2.5 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                    {ghs(p.amountGhs)}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-ink-400">
                    {date(p.receivedAt)}
                    {p.method ? ` · ${p.method}` : ''}
                  </p>
                  {p.reference && (
                    <p className="mt-0.5 font-mono text-[0.6875rem] break-all text-ink-500">
                      {p.reference}
                    </p>
                  )}
                  {p.note && (
                    <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-500">{p.note}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removePayment(p.id)}
                  aria-label={t('panel.removeReceipt', { amount: ghs(p.amountGhs) })}
                  className="grid size-7 shrink-0 place-items-center rounded-[0.5rem] text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </DetailPanel>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Recording money that arrived.
 *
 * The date defaults to today but is editable, because reconciling a week of
 * transfers on a Friday is the normal case and a receipt filed under the
 * wrong month puts the statement out against the bank.
 */
function PaymentForm({
  advertiserId,
  busy,
  onCancel,
  onDone,
  onError,
}: {
  advertiserId: string
  busy: boolean
  onCancel: () => void
  onDone: (payments?: AdvertiserPayment[], advertisers?: Advertiser[]) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.advertisers')
  const [amount, setAmount] = useState('')
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  const [pending, startTransition] = useTransition()

  const valid = /^\d{1,9}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0

  const submit = () => {
    if (!valid || pending) return
    startTransition(async () => {
      const result = await recordAdvertiserPayment({
        advertiserId,
        amount: amount.trim(),
        receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(),
        method: method.trim() || undefined,
        reference: reference.trim() || undefined,
      })
      if (!result.ok) return onError(result.message)
      onDone(result.payments, result.advertisers)
    })
  }

  return (
    <div>
      <p className="text-[0.8125rem] font-medium text-ink-900">{t('pay.title')}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t('pay.amount')} suffix="GHS">
          <input
            autoFocus
            /* inputMode decimal, not type=number: a number spinner on a money
               field invites a scroll wheel to change an amount, and the
               server parses the string anyway. */
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="2500.00"
            className={inputClass()}
          />
        </Field>
        <Field label={t('pay.received')}>
          <input
            type="date"
            value={receivedAt}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setReceivedAt(e.target.value)}
            className={inputClass()}
          />
        </Field>
        <Field label={t('pay.method')} hint={t('pay.methodHint')}>
          <input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder={t('pay.methodPlaceholder')}
            className={inputClass()}
          />
        </Field>
        <Field label={t('pay.reference')} hint={t('pay.referenceHint')}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass(false, 'font-mono')}
          />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <Button type="button" size="md" variant="secondary" onClick={onCancel} className="flex-1">
          {t('pay.cancel')}
        </Button>
        <Button
          type="button"
          size="md"
          variant="primary"
          disabled={!valid || pending || busy}
          onClick={submit}
          className="flex-1"
        >
          {t('pay.save')}
        </Button>
      </div>
    </div>
  )
}

/** Editing the contract itself. */
function ContractForm({
  advertiser: a,
  busy,
  onCancel,
  onDone,
  onError,
}: {
  advertiser: Advertiser
  busy: boolean
  onCancel: () => void
  onDone: (advertisers?: Advertiser[]) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.advertisers')
  const [form, setForm] = useState<AdvertiserInput>({
    id: a.id,
    name: a.name,
    contact: a.contact ?? '',
    status: a.status,
    startedAt: a.startedAt,
    endsAt: a.endsAt ? a.endsAt.slice(0, 10) : '',
    notes: a.notes ?? '',
  })
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof AdvertiserInput>(key: K, value: AdvertiserInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = () => {
    if (pending || (form.name ?? '').trim().length < 2) return
    startTransition(async () => {
      const result = await saveAdvertiser({
        ...form,
        endsAt: form.endsAt ? new Date(`${form.endsAt}T12:00:00`).toISOString() : undefined,
      })
      if (!result.ok) return onError(result.message)
      onDone(result.advertisers)
    })
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('form.name')} className="sm:col-span-2">
          <input
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className={inputClass()}
          />
        </Field>
        <Field label={t('form.contact')} hint={t('form.contactHint')} className="sm:col-span-2">
          <input
            value={form.contact ?? ''}
            onChange={(e) => set('contact', e.target.value)}
            className={inputClass()}
          />
        </Field>
        <Field label={t('form.endsAt')} hint={t('form.endsAtHint')}>
          <input
            type="date"
            value={form.endsAt ?? ''}
            onChange={(e) => set('endsAt', e.target.value)}
            className={inputClass()}
          />
        </Field>
        <FieldSet label={t('form.status')}>
          <Segmented
            label={t('form.status')}
            value={form.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'pending', label: t('status.pending') },
              { value: 'active', label: t('status.active') },
              { value: 'ended', label: t('status.ended') },
            ]}
          />
        </FieldSet>
      </div>

      <div className="mt-3 flex gap-2">
        <Button type="button" size="md" variant="secondary" onClick={onCancel} className="flex-1">
          {t('form.cancel')}
        </Button>
        <Button
          type="button"
          size="md"
          variant="primary"
          disabled={pending || busy}
          onClick={submit}
          className="flex-1"
        >
          {t('form.save')}
        </Button>
      </div>
    </div>
  )
}
