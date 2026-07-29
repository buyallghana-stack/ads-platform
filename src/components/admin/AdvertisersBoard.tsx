'use client'

import { useMemo, useState, useTransition } from 'react'

import { AlertTriangle, Plus, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  deleteAdvertiser,
  saveAdvertiser,
  type AdvertiserInput,
} from '@/app/[locale]/admin/advertisers/actions'
import { Button } from '@/components/ui/Button'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { Advertiser } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { EmptyState, RowOpener, SummaryCell, SummaryStrip, Toolbar, type Tab } from './AdminTable'
import { AdvertiserPanel } from './AdvertiserPanel'
import { Field, inputClass } from './FormBits'

/**
 * Advertisers — who is paying, and how much of it has been delivered.
 *
 * These contracts are keyed in by hand: there is no self-serve advertiser
 * portal and this screen does not pretend otherwise. What it does is answer
 * the question that costs money to get wrong — which contract is nearly
 * spent, and which is nearly expired — because an advertiser whose budget ran
 * out is an ad still serving that nobody is paying for.
 *
 * Delivery and time are shown together for that reason. A contract at 98%
 * spent with fifty days left and one at 24% spent with two days left are both
 * problems, and neither is visible from one number alone.
 *
 * REAL AS OF 2026-07-29. The figures come from `admin_list_advertisers`: paid
 * is the sum of recorded receipts, delivered is the value of points actually
 * credited for that advertiser's ads. Neither is stored, so neither can drift
 * from the rows that justify it.
 *
 * TRIAGE / DECIDE, as everywhere else in the admin area — the row says whether
 * to look, the panel carries the receipts and the two writes.
 */

const TONE = { active: 'success', pending: 'warning', ended: 'neutral' } as const

type Filter = 'all' | 'active' | 'pending' | 'ended'

export function AdvertisersBoard({
  initial,
  serverNow,
}: {
  initial: Advertiser[]
  /** The server's clock at render, so "days left" is decided once and is the
   *  same on both sides of hydration. */
  serverNow: number
}) {
  const t = useTranslations('admin.advertisers')
  const format = useFormatter()

  const [rows, setRows] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, startTransition] = useTransition()

  /**
   * Whole cedis once the figure is big enough for pesewas to be noise, and
   * pesewas below that.
   *
   * A flat 0dp is right for a contract of GHS 26,500 and wrong for the small
   * ones: it printed "GHS 0 spent" against an advertiser that had genuinely
   * been served, while another at GHS 0.79 rounded up to "GHS 1" — the same
   * column disagreeing with itself about whether nothing had happened. The
   * threshold is 100 because that is comfortably below any real contract and
   * comfortably above the amounts a pre-launch platform is exercising.
   */
  const ghs = (n: number) =>
    `GHS ${format.number(n, { maximumFractionDigits: n !== 0 && Math.abs(n) < 100 ? 2 : 0 })}`

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((a) => filter === 'all' || a.status === filter)
      .filter((a) => !q || [a.name, a.contact ?? ''].join(' ').toLowerCase().includes(q))
  }, [rows, filter, query])

  const tabs: Tab<Filter>[] = (['all', 'active', 'pending', 'ended'] as const).map((key) => ({
    key,
    label: t(`tabs.${key}`),
    count: key === 'all' ? rows.length : rows.filter((a) => a.status === key).length,
  }))

  /* The summary counts ACTIVE contracts only. A finished contract's leftover
     budget is not money still to be delivered, and folding it in would make
     the remaining figure grow every time something ended. */
  const active = rows.filter((a) => a.status === 'active')
  const contracted = active.reduce((n, a) => n + a.contractGhs, 0)
  const spent = active.reduce((n, a) => n + a.spentGhs, 0)

  const daysLeft = (iso: string | null) =>
    iso === null ? null : Math.ceil((new Date(iso).getTime() - serverNow) / 86_400_000)

  const applied = (next?: Advertiser[]) => {
    if (next) setRows(next)
  }

  const remove = (a: Advertiser) => {
    setError(null)
    startTransition(async () => {
      const result = await deleteAdvertiser(a.id)
      applied(result.advertisers)
      if (!result.ok) return setError(result.message)
      // The database decides between deleting and ending — an advertiser with
      // receipts against them is kept, because the statement is built from
      // those receipts. Say which happened rather than claim a delete.
      if (result.outcome === 'ended') setError(t('endedInstead', { name: a.name }))
      setOpenId(null)
    })
  }

  const menuFor = (a: Advertiser): MenuItem[] => [
    { key: 'open', label: t('menu.review'), onSelect: () => setOpenId(a.id) },
    {
      key: 'delete',
      label: a.payments > 0 ? t('menu.end') : t('menu.delete'),
      tone: 'danger',
      separated: true,
      onSelect: () => remove(a),
    },
  ]

  const open = rows.find((a) => a.id === openId) ?? null

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

      <SummaryStrip className="mb-5">
        <SummaryCell
          label={t('summary.active')}
          value={active.length}
          detail={t('summary.activeHint', { total: rows.length })}
        />
        <SummaryCell
          label={t('summary.contracted')}
          value={ghs(contracted)}
          detail={t('summary.contractedHint')}
        />
        <SummaryCell
          label={t('summary.remaining')}
          value={ghs(contracted - spent)}
          detail={t('summary.remainingHint')}
        />
      </SummaryStrip>

      <Toolbar
        tabs={tabs}
        active={filter}
        onSelect={setFilter}
        tabsLabel={t('tabsLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('searchPlaceholder')}
        actions={
          <Button type="button" size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            {t('new')}
          </Button>
        }
      />

      {visible.length === 0 ? (
        <EmptyState>{rows.length === 0 ? t('emptyAll') : t('empty')}</EmptyState>
      ) : (
        <>
          {/* Cards below md — see the finance screen for why a five-column
              money table is not something a phone can usefully scroll. */}
          <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-200">
                  {(['advertiser', 'contract', 'delivery', 'ends', 'status'] as const).map(
                    (c, i) => (
                      <th
                        key={c}
                        scope="col"
                        className={cn(
                          'px-4 py-2.5 text-[0.6875rem] font-medium tracking-[0.04em] text-ink-400 uppercase',
                          i === 1 ? 'text-right' : 'text-left',
                        )}
                      >
                        {t(`columns.${c}`)}
                      </th>
                    ),
                  )}
                  <th scope="col" className="w-10 px-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {visible.map((a) => {
                  const pct = deliveredPct(a)
                  const left = daysLeft(a.endsAt)
                  const urgent = a.status === 'active' && (pct >= 90 || (left !== null && left <= 7))
                  return (
                    <tr
                      key={a.id}
                      className={cn(
                        'relative hover:bg-ink-50/60',
                        openId === a.id && 'bg-brand-50/40',
                      )}
                    >
                      <td className="px-4 py-3">
                        <RowOpener label={t('reviewRow', { name: a.name })} onClick={() => setOpenId(a.id)}>
                          <p className="text-[0.8125rem] font-semibold text-ink-900">{a.name}</p>
                          <p className="mt-0.5 text-[0.6875rem] text-ink-400">{a.contact ?? '—'}</p>
                        </RowOpener>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <p className="text-[0.8125rem] font-medium text-ink-900 tabular-nums">
                          {ghs(a.contractGhs)}
                        </p>
                        <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                          {t('spent', { amount: ghs(a.spentGhs) })}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        <Delivery advertiser={a} pct={pct} urgent={urgent} />
                      </td>

                      <td className="px-4 py-3">
                        <EndsIn left={left} />
                      </td>

                      <td className="px-4 py-3">
                        <StatusDot tone={TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
                        {urgent && (
                          <p className="mt-0.5 text-[0.625rem] font-medium text-warning-600">
                            {t('needsAttention')}
                          </p>
                        )}
                      </td>

                      <td className="px-2 py-3">
                        <span className="relative z-10">
                          <MoreMenu label={t('menuLabel', { name: a.name })} items={menuFor(a)} />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((a) => {
              const pct = deliveredPct(a)
              const left = daysLeft(a.endsAt)
              const urgent = a.status === 'active' && (pct >= 90 || (left !== null && left <= 7))
              return (
                <li
                  key={a.id}
                  className={cn(
                    'relative rounded-(--radius-card) border bg-surface p-3.5',
                    openId === a.id ? 'border-brand-600' : 'border-ink-200',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <RowOpener label={t('reviewRow', { name: a.name })} onClick={() => setOpenId(a.id)}>
                      <p className="truncate text-[0.875rem] font-semibold text-ink-900">{a.name}</p>
                      <p className="mt-0.5 truncate text-[0.6875rem] text-ink-400">
                        {a.contact ?? '—'}
                      </p>
                    </RowOpener>
                    <div className="flex shrink-0 items-start gap-1">
                      <div className="text-right">
                        <p className="text-[0.875rem] font-semibold text-ink-900 tabular-nums">
                          {ghs(a.contractGhs)}
                        </p>
                        <p className="text-[0.6875rem] text-ink-400 tabular-nums">
                          {t('spent', { amount: ghs(a.spentGhs) })}
                        </p>
                      </div>
                      <span className="relative z-10">
                        <MoreMenu label={t('menuLabel', { name: a.name })} items={menuFor(a)} />
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-ink-200 pt-2.5">
                    <Delivery advertiser={a} pct={pct} urgent={urgent} />
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusDot tone={TONE[a.status]}>{t(`status.${a.status}`)}</StatusDot>
                    <EndsIn left={left} />
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <AdvertiserPanel
        advertiser={open}
        onClose={() => setOpenId(null)}
        onChanged={applied}
        onError={setError}
      />

      {creating && (
        <NewAdvertiser
          busy={busy}
          onClose={() => setCreating(false)}
          onCreated={(next) => {
            applied(next)
            setCreating(false)
          }}
          onError={setError}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Delivered against paid.
 *
 * Zero paid is NOT zero per cent — it is a contract with nothing to measure
 * against, and drawing an empty bar for it would read as "nothing delivered"
 * when ads may well have been served. The bar is omitted and the figure says
 * what has been delivered instead.
 */
function deliveredPct(a: Advertiser): number {
  return a.contractGhs === 0 ? 0 : Math.min(100, Math.round((a.spentGhs / a.contractGhs) * 100))
}

function Delivery({
  advertiser: a,
  pct,
  urgent,
}: {
  advertiser: Advertiser
  pct: number
  urgent: boolean
}) {
  const t = useTranslations('admin.advertisers')

  if (a.contractGhs === 0) {
    return (
      <p className="text-[0.6875rem] text-ink-400">
        {a.spentGhs > 0 ? t('unpaidButServing') : t('nothingYet')}
      </p>
    )
  }

  return (
    <div className="max-w-[12rem] min-w-[7rem]">
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          /* Amber only while the contract is still running. A finished
             contract at 100% is a job done, not a warning, and colouring it as
             one trains the operator to ignore the colour. */
          className={cn('h-full rounded-full', urgent ? 'bg-warning-500' : 'bg-brand-600')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[0.6875rem] text-ink-500 tabular-nums">{t('deliveredPct', { pct })}</p>
    </div>
  )
}

function EndsIn({ left }: { left: number | null }) {
  const t = useTranslations('admin.advertisers')
  if (left === null) return <span className="text-[0.75rem] text-ink-400">{t('noEnd')}</span>
  if (left < 0) return <span className="text-[0.75rem] text-ink-400">{t('ended')}</span>
  return (
    <span
      className={cn(
        'text-[0.75rem] tabular-nums',
        left <= 7 ? 'font-medium text-warning-600' : 'text-ink-500',
      )}
    >
      {t('daysLeft', { days: left })}
    </span>
  )
}

/**
 * Creating a contract.
 *
 * A new advertiser starts `pending` and there is no field to say otherwise:
 * money arriving is what makes a contract live, and recording their first
 * payment does it automatically. A status dropdown here would let an operator
 * mark somebody active who has not paid, which is exactly the state this
 * screen exists to make visible.
 */
function NewAdvertiser({
  busy,
  onClose,
  onCreated,
  onError,
}: {
  busy: boolean
  onClose: () => void
  onCreated: (advertisers?: Advertiser[]) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.advertisers')
  const [form, setForm] = useState<AdvertiserInput>({
    name: '',
    contact: '',
    status: 'pending',
    startedAt: new Date().toISOString(),
    endsAt: '',
  })
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof AdvertiserInput>(key: K, value: AdvertiserInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const valid = (form.name ?? '').trim().length >= 2

  const submit = () => {
    if (!valid || pending) return
    startTransition(async () => {
      const result = await saveAdvertiser({
        ...form,
        endsAt: form.endsAt ? new Date(`${form.endsAt}T12:00:00`).toISOString() : undefined,
      })
      if (!result.ok) return onError(result.message)
      onCreated(result.advertisers)
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('form.newTitle')}
      className="fixed inset-0 z-40 grid place-items-end sm:place-items-center"
    >
      <button
        type="button"
        aria-label={t('form.cancel')}
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40"
      />
      <div className="relative m-0 w-full max-w-md rounded-t-(--radius-card) border border-ink-200 bg-surface p-5 sm:m-4 sm:rounded-(--radius-card)">
        <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('form.newTitle')}</h2>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-500">{t('form.newHint')}</p>

        <div className="mt-4 grid gap-3">
          <Field label={t('form.name')}>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass()}
            />
          </Field>
          <Field label={t('form.contact')} hint={t('form.contactHint')}>
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
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="button" size="md" variant="secondary" onClick={onClose} className="flex-1">
            {t('form.cancel')}
          </Button>
          <Button
            type="button"
            size="md"
            variant="primary"
            disabled={!valid || pending || busy}
            onClick={submit}
            className="flex-1"
          >
            {t('form.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}
