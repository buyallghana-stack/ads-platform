'use client'

import { useMemo, useState, useTransition } from 'react'

import {
  ArrowLeft,
  Check,
  Coins,
  KeyRound,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { requestWithdrawal } from '@/app/[locale]/(app)/withdraw/actions'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Withdrawal wizard (operator decisions 2026-07-24):
 *
 *   - Stepped flow on EVERY breakpoint, per the operator's mobile reference
 *     (account → amount → confirm → PIN → success): money moves one decision
 *     per screen. On md+ the same steps sit in a centered card.
 *   - Amount is a NATIVE input (numeric keyboard, accessible, reliable on
 *     old Androids) with a points↔GHS toggle; the PIN step is the shared
 *     PinPad — the one place the app-like ceremony earns its keep.
 *   - REAL END TO END as of 2026-07-29. The accounts are the user's saved
 *     payout details, the PIN is verified against verify_withdrawal_pin
 *     (rate-limited), and the last step calls request_redemption: the points
 *     leave the balance and the request appears in the admin payout queue.
 *     The demo badge is gone because there is nothing demo left.
 *
 *     Everything the database can refuse it refuses AFTER the PIN, so a
 *     refusal lands on the PIN step. Two of them — not enough points, below
 *     the threshold — are about the amount rather than the PIN, so those send
 *     the user back to the amount step where the thing they must change is.
 *
 * The USDT path shows the fluctuation notice agreed at kickoff: the points
 * → GHS leg is pegged; the GHS → USD leg updates daily and the final coin
 * amount is computed at disbursement — estimates are labelled as estimates.
 */

export type WithdrawAccount = {
  id: 'mobile_money' | 'crypto'
  method: 'mobile_money' | 'crypto'
  title: string
  detail: string
}

/** Demo indicative rate for the GHS→USD leg. Labelled indicative in the UI —
 *  the real quote comes from the two-hop pricing service at request time. */
const DEMO_GHS_PER_USD = 10.45

type Step = 'account' | 'amount' | 'confirm' | 'pin' | 'success'
const STEPS: Step[] = ['account', 'amount', 'confirm', 'pin']

export function WithdrawWizard({
  balance,
  minPoints,
  pointsPerCurrencyUnit,
  tierName,
  accounts,
}: {
  balance: number
  /** The user's RESOLVED payout threshold — lower on every paid plan. */
  minPoints: number
  /** Operator config, not a constant: the rate can be changed. */
  pointsPerCurrencyUnit: number
  /** Named in the "not enough yet" copy so a subscriber can see their plan
   *  threshold is the one being applied. */
  tierName: string
  accounts: WithdrawAccount[]
}) {
  const t = useTranslations('withdraw')
  const format = useFormatter()
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [step, setStep] = useState<Step>('account')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [unit, setUnit] = useState<'points' | 'ghs'>('points')
  const [raw, setRaw] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinBlocked, setPinBlocked] = useState<null | 'locked' | 'no_pin'>(null)

  /* What the database actually recorded. The success screen renders from
     THIS, never from what the user typed — the points, the cedi value and
     the reference on screen are the ones in the row an operator will open. */
  const [filed, setFiled] = useState<{
    reference: string
    points: number
    ghs: number
    holdingUntil: string
  } | null>(null)

  // Was a module-level constant of 1000. Points-per-cedi is operator config
  // and every other screen already reads it; hardcoding it here meant a rate
  // change would silently misprice this screen alone.
  const POINTS_PER_GHS = pointsPerCurrencyUnit

  /* Nothing in the flow can succeed below the threshold, so the wizard says
     so on arrival instead of letting the user pick an amount, press Continue
     and be refused. Every quick chip was a dead end in this state: Min is
     more than the balance, Max is under the minimum. */
  const shortOf = Math.max(minPoints - balance, 0)
  const canWithdraw = shortOf === 0

  const account = accounts.find((a) => a.id === accountId) ?? null
  const isCrypto = account?.method === 'crypto'

  // Points are the unit of record; the GHS entry is convenience at the peg.
  const points = useMemo(() => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return 0
    return unit === 'points' ? Math.floor(n) : Math.round(n * POINTS_PER_GHS)
    // POINTS_PER_GHS is a prop now, not a constant — it belongs in the deps.
  }, [raw, unit, POINTS_PER_GHS])

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

  /**
   * The PIN, and the withdrawal, in one call.
   *
   * Deliberately not two: the server verifies the PIN and files the request
   * inside a single action, because two actions would be two public endpoints
   * and the second could be called without the first. So there is no "PIN
   * accepted" moment on this screen — the next thing that happens is either a
   * filed request or a refusal.
   */
  const onPin = (next: string) => {
    if (submitting || !account) return
    setPinError(null)
    setPin(next)
    if (next.length < 4) return

    setSubmitting(true)
    startTransition(async () => {
      const res = await requestWithdrawal({ method: account.method, points, pin: next })
      setSubmitting(false)

      if (res.ok) {
        setFiled({
          reference: res.reference,
          points: res.points,
          ghs: res.ghs,
          holdingUntil: res.holdingUntil,
        })
        setStep('success')
        return
      }

      setPin('')

      if (res.reason === 'no_pin') {
        setPinBlocked('no_pin')
        return
      }
      if (res.reason === 'locked') {
        const mins = res.retryAfter
          ? Math.max(1, Math.ceil((new Date(res.retryAfter).getTime() - Date.now()) / 60000))
          : 15
        setPinBlocked('locked')
        setPinError(t('pin.locked', { minutes: mins }))
        return
      }
      if (res.reason === 'wrong') {
        setPinError(t('pin.wrong', { count: res.attemptsLeft }))
        return
      }
      if (res.reason === 'refused') {
        /* The two refusals that are about the AMOUNT go back to the amount
           step. Leaving "that is more than your balance" under a PIN pad
           puts the message nowhere near the field that has to change. */
        if (res.code === 'insufficient' || res.code === 'below_minimum') {
          setAmountError(t(`refused.${res.code}`))
          setStep('amount')
          return
        }
        setPinError(
          res.code === 'cooloff' && res.hours !== null
            ? t('refused.cooloffHours', { hours: res.hours })
            : res.code === 'unknown'
              ? res.detail
              : t(`refused.${res.code}`),
        )
        return
      }

      setPinError(t('pin.error'))
    })
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
        {/* The demo badge is gone. It was honest while nothing was written;
            leaving it on a screen that now debits a real balance would be the
            opposite of what it was for. */}
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

          {!canWithdraw ? (
            /* Below the threshold there is no amount that can be submitted, so
               the screen says how far off they are and sends them back to
               earning. Letting them pick an amount first and refusing it at
               Continue is the same answer delivered three taps later. */
            <div className="mt-3 flex flex-col items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-8 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
                <Coins aria-hidden className="size-5" />
              </span>
              <p className="text-[0.9375rem] font-semibold text-ink-900">
                {t('notYet.title', { short: format.number(shortOf) })}
              </p>
              <p className="max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
                {t('notYet.body', {
                  min: format.number(minPoints),
                  ghs: format.number(minPoints / POINTS_PER_GHS, { minimumFractionDigits: 2 }),
                  balance: format.number(balance),
                  tier: tierName,
                })}
              </p>
              <div className="mt-1 w-full max-w-[16rem]">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                  <span
                    className="block h-full rounded-full bg-brand-600"
                    style={{
                      width: `${Math.min((balance / Math.max(minPoints, 1)) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
              <Link href="/ads">
                <Button size="md">{t('notYet.cta')}</Button>
              </Link>
            </div>
          ) : accounts.length === 0 ? (
            // No saved payout accounts — send them to set one up.
            <div className="mt-3 flex flex-col items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-8 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-teal-50 text-teal-600">
                <Wallet aria-hidden className="size-5" />
              </span>
              <p className="max-w-[30ch] text-[0.8125rem] leading-relaxed text-ink-500">
                {t('account.empty')}
              </p>
              <Link href="/profile/payout">
                <Button size="md">{t('account.addAccount')}</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-col gap-2.5" role="radiogroup" aria-label={t('account.title')}>
                {accounts.map((a) => {
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
                        <span className="block truncate font-mono text-[0.75rem] text-ink-500">{a.detail}</span>
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

              <Link href="/profile/payout" className="mt-3 block text-[0.75rem] text-ink-400 hover:text-ink-600">
                {t('account.manageHint')}
              </Link>

              <Button size="lg" fullWidth className="mt-5" disabled={!account} onClick={() => setStep('amount')}>
                {t('next')}
              </Button>
            </>
          )}
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
            <Button
              size="lg"
              className="flex-1"
              onClick={() => { setPin(''); setPinError(null); setPinBlocked(null); setStep('pin') }}
            >
              {t('confirm.confirm')}
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Step 4 — PIN, verified for real against verify_withdrawal_pin     */}
      {/* ---------------------------------------------------------------- */}
      {step === 'pin' && (
        <div className="animate-rise mt-8 flex flex-col items-center">
          {pinBlocked === 'no_pin' ? (
            // Reached withdraw without a PIN set — send them to set one.
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-orange-50 text-orange-600">
                <KeyRound aria-hidden className="size-6" />
              </span>
              <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('pin.noPinTitle')}</h2>
              <p className="max-w-[30ch] text-[0.8125rem] leading-relaxed text-ink-500">
                {t('pin.noPinBody')}
              </p>
              <Link href="/profile/pin">
                <Button size="md">{t('pin.setUp')}</Button>
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('pin.title')}</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-500">{t('pin.hint')}</p>

              <div className="mt-6">
                <PinPad
                  value={pin}
                  onChange={onPin}
                  disabled={submitting || pinBlocked === 'locked'}
                  ariaLabel={t('pin.title')}
                />
              </div>

              <p
                className={cn(
                  'mt-4 h-4 text-center text-[0.8125rem] font-medium',
                  pinError ? 'text-danger-600' : 'text-ink-500',
                )}
              >
                {pinError ?? (submitting ? t('pin.submitting') : '')}
              </p>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Success                                                          */}
      {/* ---------------------------------------------------------------- */}
      {step === 'success' && account && filed && (
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-success-50 text-success-600">
            <Check aria-hidden className="size-8" strokeWidth={2.5} />
          </span>
          <h2 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
            {t('success.title')}
          </h2>
          {/* Every figure here comes from the row the database wrote, not from
              what was typed into the form. */}
          <p className="mt-1.5 max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('success.body', {
              points: format.number(filed.points),
              account: account.title,
            })}
          </p>

          {/* The reference, because this is the thing a user quotes when they
              write in about a payout, and the moment they can copy it is now
              rather than after digging through their history. */}
          <p className="mt-4 rounded-(--radius-input) border border-ink-200 bg-ink-50/60 px-3 py-2 font-mono text-[0.8125rem] tracking-[0.04em] text-ink-700">
            {filed.reference}
          </p>

          <p className="mt-3 max-w-[34ch] text-[0.75rem] leading-relaxed text-ink-400">
            {t('success.holdNote', {
              when: format.dateTime(new Date(filed.holdingUntil), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>

          <div className="mt-7 flex w-full flex-col gap-2.5">
            <Button size="lg" fullWidth onClick={() => router.push('/dashboard')}>
              {t('success.home')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
