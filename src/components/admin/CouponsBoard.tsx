'use client'

import { useMemo, useState, useTransition } from 'react'

import { AlertTriangle, Check, Copy, Tag, Trash2, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  deleteCoupon,
  loadCouponRedemptions,
  saveCoupon,
  type SaveCouponInput,
} from '@/app/[locale]/admin/(super)/coupons/actions'
import { Button } from '@/components/ui/Button'
import type { CouponRedemptionRow, CouponRow, CouponTarget } from '@/lib/admin/data/coupons'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { Field, FieldSet, Segmented, SwitchRow, inputClass } from './FormBits'

/**
 * Coupon codes.
 *
 * ── A COUPON ALWAYS NAMES ITS TARGET ──
 *
 * Operator, 2026-08-11: a code that is not designated to a tier cannot be
 * used. So the target is a SELECT of real plans and programmes, never a free
 * field, and the business chooses which list is offered. The database refuses
 * an untargeted coupon too; this is the half that makes it impossible to try.
 *
 * ── THE FORM SHOWS WHAT THE DISCOUNT IS ACTUALLY WORTH ──
 *
 * An ads plan is a price BAND, so "50% off Platinum" is not one number: it is
 * GHS 260 at the floor and GHS 500 at the ceiling, and every coupon holder
 * will buy at the ceiling because that is where the discount is worth most.
 * The form works that out while the operator types, because the alternative is
 * discovering it on the finance screen a month later.
 */
export function CouponsBoard({
  coupons,
  targets,
}: {
  coupons: CouponRow[]
  targets: CouponTarget[]
}) {
  const t = useTranslations('admin.coupons')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CouponRow | 'new' | null>(null)

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
        <p className="max-w-prose text-[0.8125rem] text-ink-500">{t('intro')}</p>
        <Button size="md" leadingIcon={<Tag />} onClick={() => setEditing('new')}>
          {t('create')}
        </Button>
      </div>

      {editing && (
        <CouponForm
          coupon={editing === 'new' ? null : editing}
          targets={targets}
          onClose={() => setEditing(null)}
          onError={setError}
        />
      )}

      {coupons.length === 0 ? (
        <p className="rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.875rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <CouponList coupons={coupons} onEdit={setEditing} onError={setError} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

const cedis = (minor: number) => (minor / 100).toFixed(2)
const toMinor = (input: string) => Math.round(Number(input) * 100)

/** What one coupon takes off a purchase of this size. Mirrors `coupon_quote`. */
function discountFor(
  kind: 'percent' | 'fixed',
  percent: number,
  amountMinor: number,
  capMinor: number | null,
  priceMinor: number,
) {
  const raw = kind === 'percent' ? Math.floor((priceMinor * percent) / 100) : amountMinor
  const capped = capMinor && kind === 'percent' ? Math.min(raw, capMinor) : raw
  /* The floor under the charge, GHS 1, exactly as the database clamps it. */
  return Math.max(Math.min(capped, Math.max(priceMinor - 100, 0)), 0)
}

function CouponForm({
  coupon,
  targets,
  onClose,
  onError,
}: {
  coupon: CouponRow | null
  targets: CouponTarget[]
  onClose: () => void
  onError: (m: string | null) => void
}) {
  const t = useTranslations('admin.coupons')
  const [pending, startTransition] = useTransition()

  const [business, setBusiness] = useState<'ads' | 'affiliate'>(coupon?.business ?? 'ads')
  const [targetId, setTargetId] = useState<string>(coupon?.tierId ?? coupon?.productId ?? '')
  const [code, setCode] = useState(coupon?.code ?? '')
  const [kind, setKind] = useState<'percent' | 'fixed'>(coupon?.discountKind ?? 'percent')
  const [percent, setPercent] = useState(coupon?.percent ? String(coupon.percent) : '')
  const [amount, setAmount] = useState(coupon?.amountMinor ? cedis(coupon.amountMinor) : '')
  const [cap, setCap] = useState(coupon?.maxDiscountMinor ? cedis(coupon.maxDiscountMinor) : '')
  const [minSpend, setMinSpend] = useState(coupon?.minSpendMinor ? cedis(coupon.minSpendMinor) : '')
  const [quota, setQuota] = useState(coupon ? String(coupon.quota) : '100')
  const [perUser, setPerUser] = useState(coupon ? String(coupon.perUserLimit) : '1')
  const [firstOnly, setFirstOnly] = useState(coupon?.firstPurchaseOnly ?? true)
  const [startsAt, setStartsAt] = useState(coupon?.startsAt?.slice(0, 16) ?? '')
  const [endsAt, setEndsAt] = useState(coupon?.endsAt?.slice(0, 16) ?? '')
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true)
  const [note, setNote] = useState(coupon?.note ?? '')

  const choices = useMemo(() => targets.filter((x) => x.business === business), [targets, business])
  const target = choices.find((x) => x.id === targetId) ?? null

  /* What it is worth, at the floor of the band and at the top of it. */
  const worth = useMemo(() => {
    if (!target) return null
    const pct = Number(percent) || 0
    const amt = toMinor(amount) || 0
    const capMinor = cap ? toMinor(cap) : null
    const floor = discountFor(kind, pct, amt, capMinor, target.priceMinor)
    const ceiling =
      target.bandMaxMinor && target.bandMaxMinor > target.priceMinor
        ? discountFor(kind, pct, amt, capMinor, target.bandMaxMinor)
        : null
    return { floor, ceiling }
  }, [target, kind, percent, amount, cap])

  /* The guard the commission rule created, shown before the save is refused.
     An affiliate is paid on the price before the coupon, so a discount past
     100 minus both commission rates pays out more than the sale brings in. */
  const overCommission =
    business === 'affiliate' &&
    target?.commissionPercent != null &&
    kind === 'percent' &&
    Number(percent) > 100 - target.commissionPercent

  const ready =
    code.trim().length >= 3 &&
    targetId !== '' &&
    (kind === 'percent' ? Number(percent) > 0 : toMinor(amount) > 0) &&
    Number(quota) >= 1 &&
    Number(perUser) >= 1 &&
    Number(perUser) <= Number(quota) &&
    !overCommission &&
    !pending

  const submit = () =>
    startTransition(async () => {
      onError(null)
      const input: SaveCouponInput = {
        id: coupon?.id ?? null,
        code: code.trim().toUpperCase(),
        business,
        tierId: business === 'ads' ? targetId : null,
        productId: business === 'affiliate' ? targetId : null,
        discountKind: kind,
        percent: kind === 'percent' ? Number(percent) : null,
        amountMinor: kind === 'fixed' ? toMinor(amount) : null,
        maxDiscountMinor: kind === 'percent' && cap ? toMinor(cap) : null,
        minSpendMinor: minSpend ? toMinor(minSpend) : 0,
        quota: Number(quota),
        perUserLimit: Number(perUser),
        firstPurchaseOnly: firstOnly,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        isActive,
        note: note.trim() || null,
      }
      const r = await saveCoupon(input)
      if (r.ok) onClose()
      else onError(r.message)
    })

  return (
    <div className="mb-5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <FieldSet label={t('form.business')} hint={t('form.businessHint')}>
          <Segmented
            value={business}
            label={t('form.business')}
            disabled={Boolean(coupon)}
            onChange={(v) => {
              setBusiness(v)
              setTargetId('')
            }}
            options={[
              { value: 'ads', label: t('business.ads') },
              { value: 'affiliate', label: t('business.affiliate') },
            ]}
          />
        </FieldSet>

        <Field label={t('form.target')} hint={t('form.targetHint')}>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className={inputClass(targetId === '')}
          >
            <option value="">{t('form.targetPlaceholder')}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('form.code')} hint={t('form.codeHint')}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH50"
            spellCheck={false}
            className={inputClass(false, 'font-mono tracking-[0.12em] uppercase')}
          />
        </Field>

        <FieldSet label={t('form.kind')}>
          <Segmented
            value={kind}
            label={t('form.kind')}
            onChange={setKind}
            options={[
              { value: 'percent', label: t('kind.percent') },
              { value: 'fixed', label: t('kind.fixed') },
            ]}
          />
        </FieldSet>

        {kind === 'percent' ? (
          <>
            <Field label={t('form.percent')} suffix="%">
              <input
                type="number"
                min={1}
                max={100}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className={inputClass(overCommission)}
              />
            </Field>
            <Field label={t('form.cap')} suffix="GHS" hint={t('form.capHint')}>
              <input
                type="number"
                min={0}
                step="0.01"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className={inputClass()}
              />
            </Field>
          </>
        ) : (
          <Field label={t('form.amount')} suffix="GHS">
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass()}
            />
          </Field>
        )}

        <Field label={t('form.minSpend')} suffix="GHS" hint={t('form.minSpendHint')}>
          <input
            type="number"
            min={0}
            step="0.01"
            value={minSpend}
            onChange={(e) => setMinSpend(e.target.value)}
            className={inputClass()}
          />
        </Field>

        <Field label={t('form.quota')} hint={t('form.quotaHint')}>
          <input
            type="number"
            min={1}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            className={inputClass(Number(quota) < 1)}
          />
        </Field>

        <Field label={t('form.perUser')} hint={t('form.perUserHint')}>
          <input
            type="number"
            min={1}
            value={perUser}
            onChange={(e) => setPerUser(e.target.value)}
            className={inputClass(Number(perUser) > Number(quota))}
          />
        </Field>

        <Field label={t('form.startsAt')} hint={t('form.windowHint')}>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputClass()}
          />
        </Field>

        <Field label={t('form.endsAt')}>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputClass()}
          />
        </Field>

        <Field label={t('form.note')} className="sm:col-span-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('form.notePlaceholder')}
            className={inputClass()}
          />
        </Field>
      </div>

      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
        <SwitchRow
          title={t('form.firstOnly')}
          description={t('form.firstOnlyHint')}
          checked={firstOnly}
          onChange={setFirstOnly}
        />
        <SwitchRow
          title={t('form.active')}
          description={t('form.activeHint')}
          checked={isActive}
          onChange={setIsActive}
        />
      </div>

      {/* WHAT IT IS WORTH. A band has two ends and a percentage means a
          different number at each, so both are shown rather than left to be
          discovered on a finance report. */}
      {worth && target && (
        <p className="mt-3.5 rounded-(--radius-card) bg-ink-50 px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-ink-600">
          {worth.ceiling === null
            ? t('worth.one', {
                off: cedis(worth.floor),
                price: cedis(target.priceMinor),
                pays: cedis(target.priceMinor - worth.floor),
              })
            : t('worth.band', {
                off: cedis(worth.floor),
                price: cedis(target.priceMinor),
                offTop: cedis(worth.ceiling),
                top: cedis(target.bandMaxMinor ?? 0),
              })}
        </p>
      )}

      {overCommission && target?.commissionPercent != null && (
        <p
          role="alert"
          className="mt-2.5 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-danger-700"
        >
          {t('overCommission', {
            pays: target.commissionPercent,
            most: 100 - target.commissionPercent,
          })}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </Button>
        {/* NOT `t('create')`, which is the button that OPENS this form. Two
            buttons reading "New coupon" on one screen is ambiguous for anybody
            using it and outright unusable for a screen reader, and it is what
            made the first verification run click the wrong one. */}
        <Button type="button" size="md" onClick={submit} disabled={!ready}>
          {coupon ? t('save') : t('form.submit')}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CouponList({
  coupons,
  onEdit,
  onError,
}: {
  coupons: CouponRow[]
  onEdit: (c: CouponRow) => void
  onError: (m: string | null) => void
}) {
  const t = useTranslations('admin.coupons')
  const format = useFormatter()
  const [copied, setCopied] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, CouponRedemptionRow[]>>({})
  const [busy, startTransition] = useTransition()

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard blocked. The code is on screen and selectable.
    }
  }

  const toggle = (id: string) => {
    if (open === id) {
      setOpen(null)
      return
    }
    setOpen(id)
    if (rows[id]) return
    startTransition(async () => {
      const r = await loadCouponRedemptions(id)
      if (r.ok) setRows((prev) => ({ ...prev, [id]: r.data }))
      else onError(r.message)
    })
  }

  const remove = (id: string) =>
    startTransition(async () => {
      const r = await deleteCoupon(id)
      if (!r.ok) onError(r.message)
    })

  const value = (c: CouponRow) =>
    c.discountKind === 'percent'
      ? t('valuePercent', { percent: c.percent ?? 0 })
      : t('valueFixed', { amount: cedis(c.amountMinor ?? 0) })

  return (
    <>
      {/* Cards below lg, table at lg+. A code plus a target plus a quota plus
          two money columns does not survive a phone-width table, and a screen
          that renders nothing below lg is a screen that is blank on a phone. */}
      <ul className="flex flex-col gap-2.5 lg:hidden">
        {coupons.map((c) => (
          <li key={c.id} className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => copy(c.code)}
                className="flex items-center gap-1.5 font-mono text-[0.9375rem] tracking-[0.12em] text-ink-900"
              >
                {c.code}
                {copied === c.code ? (
                  <Check aria-hidden className="size-3.5 text-success-600" />
                ) : (
                  <Copy aria-hidden className="size-3.5 text-ink-400" />
                )}
              </button>
              <StatusDot tone={c.isActive ? 'success' : 'neutral'}>
                {t(c.isActive ? 'status.active' : 'status.off')}
              </StatusDot>
            </div>
            <p className="mt-2 text-[0.8125rem] text-ink-700">
              {value(c)} · {c.targetName ?? t('noTarget')}
            </p>
            <p className="mt-1 text-[0.75rem] text-ink-500">
              {t('usedOf', { used: c.used, quota: c.quota })}
            </p>
            {c.discountGivenMinor > 0 && (
              <p className="mt-1 text-[0.75rem] text-ink-500">
                {t('cost', { off: cedis(c.discountGivenMinor), took: cedis(c.revenueMinor) })}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(c)}>
                {t('edit')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => toggle(c.id)}>
                {t('who')}
              </Button>
            </div>
            {open === c.id && <Redemptions rows={rows[c.id]} busy={busy} />}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 lg:block">
        <table className="w-full">
          <thead className="bg-ink-50/60">
            <tr className="text-left text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-ink-500">
              <th className="px-4 py-2.5">{t('col.code')}</th>
              <th className="px-4 py-2.5">{t('col.target')}</th>
              <th className="px-4 py-2.5">{t('col.value')}</th>
              <th className="px-4 py-2.5 text-right">{t('col.used')}</th>
              <th className="px-4 py-2.5 text-right">{t('col.cost')}</th>
              <th className="px-4 py-2.5">{t('col.status')}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {coupons.map((c) => (
              <tr key={c.id} className="text-[0.8125rem] align-top">
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
                  {c.note && <p className="mt-1 text-[0.75rem] text-ink-400">{c.note}</p>}
                </td>
                <td className="px-4 py-3 text-ink-700">
                  {c.targetName ?? t('noTarget')}
                  <span className="block text-[0.75rem] text-ink-400">
                    {t(`business.${c.business}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-700">{value(c)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                  {t('usedOf', { used: c.used, quota: c.quota })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-500">
                  {c.discountGivenMinor > 0
                    ? format.number(c.discountGivenMinor / 100, {
                        style: 'currency',
                        currency: 'GHS',
                      })
                    : t('none')}
                </td>
                <td className="px-4 py-3">
                  <StatusDot tone={c.isActive ? 'success' : 'neutral'}>
                    {t(c.isActive ? 'status.active' : 'status.off')}
                  </StatusDot>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(c.id)}
                      className="text-[0.8125rem] font-medium text-ink-600 hover:underline"
                    >
                      {t('who')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(c)}
                      className="text-[0.8125rem] font-medium text-brand-700 hover:underline"
                    >
                      {t('edit')}
                    </button>
                    {c.used === 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(c.id)}
                        className={cn(
                          'text-[0.8125rem] font-medium text-danger-700 hover:underline',
                          'disabled:opacity-50',
                        )}
                      >
                        <Trash2 aria-hidden className="inline size-3.5" />
                        <span className="sr-only">{t('delete')}</span>
                      </button>
                    )}
                  </div>
                  {open === c.id && <Redemptions rows={rows[c.id]} busy={busy} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Redemptions({ rows, busy }: { rows: CouponRedemptionRow[] | undefined; busy: boolean }) {
  const t = useTranslations('admin.coupons')
  const format = useFormatter()

  if (!rows) {
    return <p className="mt-2.5 text-[0.75rem] text-ink-400">{busy ? t('loading') : null}</p>
  }
  if (rows.length === 0) {
    return <p className="mt-2.5 text-[0.75rem] text-ink-400">{t('noneYet')}</p>
  }

  return (
    <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-ink-100 pt-2.5 text-left">
      {rows.map((r) => (
        <li key={r.id} className="text-[0.75rem] text-ink-600">
          <span className="text-ink-900">{r.person ?? r.email}</span>{' '}
          {t('tookOff', { off: cedis(r.discountMinor), paid: cedis(r.chargedMinor) })}{' '}
          <span className="text-ink-400">
            {format.dateTime(new Date(r.createdAt), { day: 'numeric', month: 'short' })}
            {r.status !== 'confirmed' ? ` · ${t(`redemption.${r.status ?? 'pending'}`)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
