'use client'

import { useMemo, useState } from 'react'

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Coins,
  Delete,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Withdrawal wizard (operator decisions 2026-07-24):
 *
 *   - Stepped flow on EVERY breakpoint, per the operator's mobile reference
 *     (account → amount → confirm → PIN → success): money moves one decision
 *     per screen. On md+ the same steps sit in a centered card.
 *   - Amount is a NATIVE input (numeric keyboard, accessible, reliable on
 *     old Androids) with a points↔GHS toggle; the PIN step is the custom
 *     4-dot pad — the one place the app-like ceremony earns its keep.
 *   - PURE DEMO, badged as such: payout accounts and the PIN are set up in
 *     the Profile tab (not built yet), so the accounts below are demo data
 *     and submission writes NOTHING. The real request_redemption pipeline
 *     is wired when Profile ships.
 *
 * The USDT path shows the fluctuation notice agreed at kickoff: the points
 * → GHS leg is pegged; the GHS → USD leg updates daily and the final coin
 * amount is computed at disbursement — estimates are labelled as estimates.
 */

/** Demo payout accounts — the schema allows ONE saved detail per method
 *  (PK user_id+method), so exactly one MoMo and one crypto entry. Shapes
 *  mirror user_payout_details so swapping in real rows is mechanical. */
const DEMO_ACCOUNTS = [
  {
    id: 'momo',
    method: 'mobile_money' as const,
    title: 'MTN Mobile Money',
    detail: '024 000 0002 · Demo User',
  },
  {
    id: 'usdt',
    method: 'crypto' as const,
    title: 'USDT · Tron (TRC20)',
    detail: 'TQrfDemo…3kF9',
  },
]

/** Demo indicative rate for the GHS→USD leg. Labelled indicative in the UI —
 *  the real quote comes from the two-hop pricing service at request time. */
const DEMO_GHS_PER_USD = 10.45
const POINTS_PER_GHS = 1000

type Step = 'account' | 'amount' | 'confirm' | 'pin' | 'success'
const STEPS: Step[] = ['account', 'amount', 'confirm', 'pin']

export function WithdrawWizard({
  balance,
  minPoints,
}: {
  balance: number
  minPoints: number
}) {
  const t = useTranslations('withdraw')
  const format = useFormatter()
  const router = useRouter()

  const [step, setStep] = useState<Step>('account')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [unit, setUnit] = useState<'points' | 'ghs'>('points')
  const [raw, setRaw] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const account = DEMO_ACCOUNTS.find((a) => a.id === accountId) ?? null
  const isCrypto = account?.method === 'crypto'

  // Points are the unit of record; the GHS entry is convenience at the peg.
  const points = useMemo(() => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return 0
    return unit === 'points' ? Math.floor(n) : Math.round(n * POINTS_PER_GHS)
  }, [raw, unit])

  const ghs = points / POINTS_PER_GHS
  const usdEstimate = ghs / DEMO_GHS_PER_USD

  const stepIndex = STEPS.indexOf(step)

  const back = () => {
    if (step === 'account' || step === 'success') router.push('/dashboard')
    else setStep(STEPS[stepIndex - 1])
  }

  const validateAmount = () => {
    if (points < minPoints) return t('errors.belowMin', { min: format.number(minPoints), ghs: format.number(minPoints / POINTS_PER_GHS, { minimumFractionDigits: 2 }) })
    if (points > balance) return t('errors.aboveBalance')
    return null
  }

  const nextFromAmount = () => {
    const err = validateAmount()
    setAmountError(err)
    if (!err) setStep('confirm')
  }

  const pressPin = (digit: string) => {
    if (submitting) return
    if (digit === 'back') {
      setPin((p) => p.slice(0, -1))
      return
    }
    const next = (pin + digit).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      // DEMO: no PIN exists server-side yet (Profile tab ships it), so any
      // 4 digits complete the flow and nothing is written anywhere.
      setSubmitting(true)
      setTimeout(() => {
        setSubmitting(false)
        setStep('success')
      }, 900)
    }
  }

  const fluctuationNotice = (compact: boolean) => (
    <div
      role="note"
      className={cn(
        'flex gap-2.5 rounded-(--radius-input) border border-warning-500/25 bg-warning-50 text-warning-600',
        compact ? 'px-3 py-2 text-[0.75rem]' : 'px-3.5 py-3 text-[0.8125rem]',
      )}
    >
      <TriangleAlert aria-hidden className={cn('shrink-0', compact ? 'mt-0.5 size-3.5' : 'mt-0.5 size-4')} />
      <span className="leading-relaxed">{t('usdtNotice')}</span>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-[26rem] px-5 pb-10 pt-4 sm:px-0 md:pt-8">
      {/* ---------------------------------------------------------------- */}
      {/* Header: back, title, demo badge, progress                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={back}
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-4.5" />
        </button>
        <h1 className="flex-1 text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h1>
        <Badge tone="warning">{t('demoBadge')}</Badge>
      </div>

      {step !== 'success' && (
        <div className="mt-4 flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                i <= stepIndex ? 'bg-brand-600' : 'bg-ink-200',
              )}
            />
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 1 — choose account                                          */}
      {/* ---------------------------------------------------------------- */}
      {step === 'account' && (
        <div className="animate-rise mt-6">
          <h2 className="text-sm font-medium text-ink-700">{t('account.title')}</h2>
          <div className="mt-3 flex flex-col gap-2.5" role="radiogroup" aria-label={t('account.title')}>
            {DEMO_ACCOUNTS.map((a) => {
              const selected = accountId === a.id
              const Icon = a.method === 'crypto' ? Coins : Smartphone
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAccountId(a.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-(--radius-card) border bg-surface p-3.5 text-left',
                    'transition-[border-color,box-shadow] duration-150',
                    selected
                      ? 'border-brand-600 shadow-[0_0_0_3px] shadow-brand-600/12'
                      : 'border-ink-200 hover:border-ink-300',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-full',
                      a.method === 'crypto' ? 'bg-teal-50 text-teal-600' : 'bg-brand-50 text-brand-600',
                    )}
                  >
                    <Icon aria-hidden className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.875rem] font-semibold text-ink-900">{a.title}</span>
                    <span className="block truncate text-[0.75rem] text-ink-500">{a.detail}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
                      selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300',
                    )}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-400">{t('account.manageHint')}</p>

          <Button size="lg" fullWidth className="mt-5" disabled={!account} onClick={() => setStep('amount')}>
            {t('next')}
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 2 — amount                                                  */}
      {/* ---------------------------------------------------------------- */}
      {step === 'amount' && account && (
        <div className="animate-rise mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink-700">{t('amount.title')}</h2>
            {/* Unit toggle: entry in whichever unit the user thinks in. */}
            <div role="tablist" aria-label={t('amount.unitLabel')} className="flex gap-0.5 rounded-full bg-ink-100 p-0.5">
              {(['points', 'ghs'] as const).map((u) => (
                <button
                  key={u}
                  role="tab"
                  aria-selected={unit === u}
                  onClick={() => { setUnit(u); setRaw(''); setAmountError(null) }}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[0.75rem] font-semibold transition-colors',
                    unit === u ? 'bg-surface text-ink-900 shadow-[0_1px_2px_rgb(15_23_42/0.08)]' : 'text-ink-500',
                  )}
                >
                  {u === 'points' ? t('amount.points') : 'GHS'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[0.875rem] font-semibold text-ink-400">
                {unit === 'points' ? t('amount.ptsSymbol') : 'GHS'}
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={raw}
                onChange={(e) => {
                  // Digits and one decimal point (GHS only); nothing else.
                  const clean = e.target.value.replace(unit === 'points' ? /[^\d]/g : /[^\d.]/g, '')
                  setRaw(clean)
                  setAmountError(null)
                }}
                aria-label={t('amount.title')}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? 'amount-error' : 'amount-context'}
                className={cn(
                  'h-14 w-full rounded-(--radius-input) border bg-surface pl-14 pr-4 text-right text-[1.5rem] font-bold tabular-nums text-ink-900',
                  'transition-[border-color,box-shadow] duration-150 focus:outline-none',
                  amountError
                    ? 'border-danger-500 focus:border-danger-600 focus:shadow-[0_0_0_3px] focus:shadow-danger-500/12'
                    : 'border-ink-200 hover:border-ink-300 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12',
                )}
              />
            </div>

            <div id="amount-context" className="mt-2 flex items-baseline justify-between text-[0.75rem] text-ink-500">
              <span>
                {points > 0
                  ? unit === 'points'
                    ? `≈ GHS ${format.number(ghs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : t('amount.asPoints', { points: format.number(points) })
                  : t('amount.minHint', { min: format.number(minPoints), ghs: format.number(minPoints / POINTS_PER_GHS, { minimumFractionDigits: 2 }) })}
              </span>
              <span className="tabular-nums">{t('amount.balance', { balance: format.number(balance) })}</span>
            </div>

            {amountError && (
              <p id="amount-error" role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
                {amountError}
              </p>
            )}

            {/* Quick amounts, computed in points then shown in the active unit. */}
            <div className="mt-3 flex gap-2">
              {[
                { key: 'min', pts: minPoints },
                { key: 'half', pts: Math.floor(balance / 2) },
                { key: 'max', pts: balance },
              ].map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => {
                    setUnit('points')
                    setRaw(String(q.pts))
                    setAmountError(null)
                  }}
                  className="flex-1 rounded-full border border-ink-200 px-2 py-1.5 text-[0.75rem] font-medium text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700"
                >
                  {t(`amount.quick.${q.key}` as 'amount.quick.min')}
                </button>
              ))}
            </div>

            {isCrypto && points > 0 && (
              <p className="mt-4 text-[0.8125rem] text-ink-600">
                {t('amount.usdtEstimate', {
                  usd: format.number(usdEstimate, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  rate: format.number(DEMO_GHS_PER_USD, { minimumFractionDigits: 2 }),
                })}
              </p>
            )}
            {isCrypto && <div className="mt-3">{fluctuationNotice(false)}</div>}

            <Button size="lg" fullWidth className="mt-5" disabled={points <= 0} onClick={nextFromAmount}>
              {t('next')}
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 3 — confirm                                                 */}
      {/* ---------------------------------------------------------------- */}
      {step === 'confirm' && account && (
        <div className="animate-rise mt-6">
          <h2 className="text-sm font-medium text-ink-700">{t('confirm.title')}</h2>

          <div className="mt-3 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
            <dl className="divide-y divide-ink-100">
              {[
                { label: t('confirm.to'), value: `${account.title}` },
                { label: t('confirm.amount'), value: `${format.number(points)} ${t('amount.points')}` },
                { label: t('confirm.value'), value: `GHS ${format.number(ghs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                ...(isCrypto
                  ? [{ label: t('confirm.estimate'), value: `≈ ${format.number(usdEstimate, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` }]
                  : []),
                { label: t('confirm.fee'), value: t('confirm.feeFree') },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <dt className="text-[0.8125rem] text-ink-500">{row.label}</dt>
                  <dd className="text-right text-[0.8125rem] font-semibold tabular-nums text-ink-900">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {isCrypto && <div className="mt-3">{fluctuationNotice(true)}</div>}

          <p className="mt-3 flex gap-2 text-[0.75rem] leading-relaxed text-ink-500">
            <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
            {t('confirm.holdNote')}
          </p>

          <div className="mt-5 flex gap-3">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep('amount')}>
              {t('confirm.edit')}
            </Button>
            <Button size="lg" className="flex-1" onClick={() => { setPin(''); setStep('pin') }}>
              {t('confirm.confirm')}
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 4 — PIN (custom pad, the reference's ceremony)              */}
      {/* ---------------------------------------------------------------- */}
      {step === 'pin' && (
        <div className="animate-rise mt-8 flex flex-col items-center">
          <h2 className="text-sm font-medium text-ink-700">{t('pin.title')}</h2>
          <p className="mt-1 text-[0.75rem] text-ink-400">{t('pin.demoHint')}</p>

          <div className="mt-6 flex gap-3" aria-label={t('pin.title')} role="status">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'size-3.5 rounded-full border transition-colors duration-150',
                  i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-ink-300',
                )}
              />
            ))}
          </div>

          {/* Dialer: each digit in its own circle, the delete key a bare
              icon. Generous, evenly spaced, thumb-sized on touch. */}
          <div className="mt-8 grid grid-cols-3 justify-items-center gap-x-5 gap-y-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((key, i) =>
              key === '' ? (
                // Keeps the grid aligned so 0 sits centre-bottom.
                <span key={i} className="size-16 pointer-coarse:size-[4.25rem]" />
              ) : (
                <button
                  key={i}
                  type="button"
                  disabled={submitting}
                  onClick={() => pressPin(key)}
                  aria-label={key === 'back' ? t('pin.delete') : key}
                  className={cn(
                    'grid size-16 place-items-center rounded-full text-[1.625rem] font-semibold tabular-nums text-ink-900',
                    'transition-[background-color,border-color,transform] duration-100 active:scale-90',
                    'pointer-coarse:size-[4.25rem]',
                    key === 'back'
                      ? // Delete: no circle, just the glyph.
                        'text-ink-500 hover:text-ink-900 disabled:opacity-40'
                      : 'border border-ink-200 bg-surface hover:border-ink-300 hover:bg-ink-100 disabled:opacity-40',
                  )}
                >
                  {key === 'back' ? <Delete aria-hidden className="size-6" /> : key}
                </button>
              ),
            )}
          </div>

          {submitting && <p className="mt-6 text-[0.8125rem] text-ink-500">{t('pin.submitting')}</p>}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Success                                                          */}
      {/* ---------------------------------------------------------------- */}
      {step === 'success' && account && (
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-success-50 text-success-600">
            <Check aria-hidden className="size-8" strokeWidth={2.5} />
          </span>
          <h2 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
            {t('success.title')}
          </h2>
          <p className="mt-1.5 max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('success.body', {
              points: format.number(points),
              account: account.title,
            })}
          </p>
          <p className="mt-3 max-w-[34ch] text-[0.75rem] leading-relaxed text-ink-400">
            {t('success.holdNote')}
          </p>

          <div className="mt-7 flex w-full flex-col gap-2.5">
            <Button size="lg" fullWidth onClick={() => router.push('/dashboard')}>
              {t('success.home')}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              trailingIcon={<ChevronRight />}
              onClick={() => router.push('/dashboard')}
            >
              {t('success.history')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
