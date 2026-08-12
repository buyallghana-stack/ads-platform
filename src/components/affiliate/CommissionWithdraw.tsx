'use client'

import { useMemo, useState, useTransition } from 'react'

import { ArrowLeft, Check, Coins, KeyRound, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  requestCommissionWithdrawal,
  type CommissionWithdrawResult,
} from '@/app/[locale]/(affiliate)/commission/withdraw/actions'
import { PinPad } from '@/components/ui/PinPad'
import { Link, useRouter } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * Requesting a commission payout.
 *
 * ── THE SAME FLOW AS THE ADS WITHDRAWAL, STEP FOR STEP ──
 *
 * Operator, 2026-08-12, with the ads flow attached screen by screen: imitate
 * it. So this is destination → amount → confirm → PIN → filed, one decision per
 * screen, with the four-segment progress bar, the circular back button, the
 * card list of payout accounts, the confirmation table and the PIN pad the ads
 * side uses. Somebody who has withdrawn points once already knows this screen.
 *
 * An earlier version of this component argued the opposite: two steps, because
 * commission is already cedis and there is no peg to explain. That reasoning
 * was about the DATA and the operator's point is about the PERSON. Two screens
 * that take money out of the same platform should not feel like two products,
 * and the steps that carry no conversion still carry the decision.
 *
 * ── WHAT IS DELIBERATELY NOT COPIED ──
 *
 * The points ↔ GHS unit toggle, the peg line and the tier threshold. Commission
 * is cedis, so there is nothing to convert and one minimum covers everybody. A
 * toggle with one unit in it is furniture, not a control. And this is still NOT
 * built on `WithdrawWizard`: sharing that component would put a points balance
 * inside the affiliate business, which D27 forbids. It shares the primitives
 * (`PinPad`) and the shape, not the state.
 *
 * ── THE PIN AND THE REQUEST ARE ONE CALL ──
 *
 * Exactly as on the ads side: the server verifies the PIN and files the request
 * in a single action, so there is no "PIN accepted" moment that could be
 * reached without the request behind it. Refusals about the AMOUNT send the
 * user back to the amount step, because a message about the balance under a PIN
 * pad is nowhere near the field that has to change.
 */

type Destination = {
  method: 'mobile_money' | 'crypto'
  title: string
  /** Already masked upstream — this component never sees a full number. */
  detail: string
}

type Step = 'account' | 'amount' | 'confirm' | 'pin'
const STEPS: Step[] = ['account', 'amount', 'confirm', 'pin']

export function CommissionWithdraw({
  balanceMinor,
  minimumMinor,
  feePercent,
  destinations,
  payoutsEnabled,
  openRequest,
}: {
  balanceMinor: number
  minimumMinor: number
  feePercent: number
  /* ⚠️ A LIST, NOT ONE. `user_payout_details` is keyed (user_id, method), so
     somebody may hold a mobile money destination AND a crypto one. This screen
     used to be handed a single row read with `.maybeSingle()`, which ERRORS on
     two rows and returns null — so adding a second payout method made the
     screen insist there were none, which is exactly what the operator hit on
     the manager account (2026-08-12). */
  destinations: Destination[]
  payoutsEnabled: boolean
  /** One at a time, by unique index. Said here rather than discovered by
   *  filling the form in and being refused by a constraint. */
  openRequest: boolean
}) {
  const t = useTranslations('affiliate.withdraw')
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [step, setStep] = useState<Step>('account')
  /* Preselected, unlike the ads side, because the page hands these over with
     mobile money first and almost nobody is paid in coin. One tap saved on the
     screen everybody sees. */
  const [method, setMethod] = useState<Destination['method'] | null>(
    destinations[0]?.method ?? null,
  )
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinBlocked, setPinBlocked] = useState<null | 'locked' | 'no_pin'>(null)

  /* What the DATABASE recorded, never what was typed. The success screen reads
     from this: the amount, the fee and the reference on it are the ones on the
     row an operator will open. */
  const [filed, setFiled] = useState<Extract<CommissionWithdrawResult, { ok: true }> | null>(null)

  /* Parsed in MAJOR units because that is what somebody types, then converted
     once. Every downstream figure is minor units — a float carried further
     than this is how a rounding bug starts. */
  const amountMinor = useMemo(() => {
    const parsed = Number(amount.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.round(parsed * 100)
  }, [amount])

  const feeMinor = Math.round((amountMinor * feePercent) / 100)
  const netMinor = amountMinor - feeMinor

  const destination = destinations.find((d) => d.method === method) ?? destinations[0] ?? null
  const stepIndex = STEPS.indexOf(step)

  const back = () => {
    if (step === 'account') router.push('/commission')
    else setStep(STEPS[stepIndex - 1])
  }

  /*
    THE FRAME THE ADS WITHDRAWAL USES: a circular back button, one small title,
    and a progress bar with one segment per step. Every state below renders
    inside it, so a person filling this in and a person filling in the points
    withdrawal are looking at the same screen furniture.

    Brand tokens, not violet ones: `.affiliate` on the layout wrapper already
    remaps brand to violet inside this tree, so `bg-brand-600` here IS the
    violet the operator sees, and it follows the skin if the skin ever moves.
  */
  const frame = (children: React.ReactNode, showSteps = true) => (
    <>
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
      </div>

      {showSteps && (
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

      <div className="mt-6">{children}</div>
    </>
  )

  /**
   * The PIN, and the withdrawal, in one call. Fired the moment the fourth
   * digit lands, exactly as the ads pad does, so there is no button between
   * the last digit and the request.
   */
  const onPin = (next: string) => {
    if (submitting || !destination) return
    setPinError(null)
    setPin(next)
    if (next.length < 4) return

    setSubmitting(true)
    startTransition(async () => {
      const res = await requestCommissionWithdrawal({
        amountMinor,
        pin: next,
        method: destination.method,
      })
      setSubmitting(false)

      if (res.ok) {
        setFiled(res)
        return
      }

      setPin('')

      if (res.reason === 'no_pin') {
        setPinBlocked('no_pin')
        return
      }
      if (res.reason === 'locked') {
        setPinBlocked('locked')
        setPinError(t('pinLocked'))
        return
      }
      if (res.reason === 'wrong') {
        setPinError(t('pinWrong', { n: res.attemptsLeft }))
        return
      }
      if (res.reason === 'refused') {
        /* The refusals that are about the AMOUNT go back to the amount step.
           The database writes them in plain English and two of them carry the
           figure that matters, so its own words beat anything this layer could
           substitute — the code only decides where the message lands. */
        if (res.code === 'too_much' || res.code === 'below_minimum') {
          setAmountError(res.detail)
          setStep('amount')
          return
        }
        setPinError(
          res.code === 'already_open'
            ? t('alreadyOpen')
            : res.code === 'unknown'
              ? /* Never `detail` here. An unclassified failure is by definition
                   a message nobody wrote for a reader — a constraint name, a
                   type error — and a money screen is the last place to print
                   one. */
                t('failed')
              : res.detail,
        )
        return
      }

      setPinError(t('failed'))
    })
  }

  /* ---------------- filed ---------------- */
  if (filed) {
    return frame(
      <div className="animate-rise flex flex-col items-center text-center">
        <span className="grid size-16 place-items-center rounded-full bg-success-50 text-success-600">
          <Check aria-hidden className="size-8" strokeWidth={2.5} />
        </span>
        <h2 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('done.title')}
        </h2>
        <p className="mt-1.5 max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
          {/* Crypto is denominated in the COIN, never in cedis — locked
              operator rule. The coin amount is frozen on the row, so this is
              what will be sent whatever the price does before it is paid. */}
          {filed.coin && filed.coinAmount !== undefined
            ? t('done.bodyCoin', {
                amount: String(filed.coinAmount),
                coin: filed.coin,
                account: destination?.title ?? '',
              })
            : t('done.bodyTo', {
                amount: cedis(filed.netMinor),
                account: destination?.title ?? '',
              })}
        </p>

        {/* The reference, because this is what somebody quotes when they write
            in about a payout, and the moment to copy it is now rather than
            after digging through their history. */}
        <p className="mt-4 rounded-(--radius-input) border border-ink-200 bg-ink-50/60 px-3 py-2 font-mono text-[0.8125rem] tracking-[0.04em] text-ink-700">
          {filed.reference}
        </p>

        <p className="mt-3 max-w-[34ch] text-[0.75rem] leading-relaxed text-ink-400">
          {t('done.body')}
        </p>

        <dl className="mt-5 w-full max-w-xs space-y-2 text-left">
          <Row label={t('requested')} value={cedis(filed.amountMinor)} />
          <Row label={t('fee')} value={`− ${cedis(filed.feeMinor)}`} />
          <Row label={t('done.youGet')} value={cedis(filed.netMinor)} strong />
        </dl>

        <Link
          href="/commission"
          className="mt-7 w-full rounded-(--radius-input) bg-brand-600 px-5 py-3.5 text-center text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          {t('done.back')}
        </Link>
      </div>,
      false,
    )
  }

  /* ----------------  not enough yet  ----------------
     Its own screen, above the other blocked states, because it is the only one
     that is a matter of TIME rather than of something being wrong. The way in
     is the shop rather than a dead end: what closes this gap is another sale,
     so the button goes where the products are. */
  if (payoutsEnabled && destination && !openRequest && balanceMinor < minimumMinor) {
    const shortMinor = minimumMinor - balanceMinor
    return frame(
      <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700"
        >
          <Wallet className="size-6" />
        </span>
        <h2 className="mt-3 text-[1rem] font-semibold text-ink-900">
          {t('notYet.title', { amount: cedis(shortMinor) })}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
          {t('notYet.body', { minimum: cedis(minimumMinor), balance: cedis(balanceMinor) })}
        </p>

        <div className="mx-auto mt-4 w-full max-w-[16rem]">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
            <span
              className="block h-full rounded-full bg-brand-600"
              style={{
                width: `${Math.min((balanceMinor / Math.max(minimumMinor, 1)) * 100, 100)}%`,
              }}
            />
          </div>
        </div>

        <Link
          href="/shop"
          className="mt-5 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          {t('notYet.cta')}
        </Link>
      </section>,
      false,
    )
  }

  /* ---------------- blocked before it starts ---------------- */
  if (!payoutsEnabled || !destination || openRequest || balanceMinor <= 0) {
    const key = !payoutsEnabled
      ? 'closed'
      : !destination
        ? 'noDestination'
        : openRequest
          ? 'openRequest'
          : 'nothing'
    return frame(
      <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-ink-100 text-ink-400"
        >
          <Wallet className="size-6" />
        </span>
        <h2 className="mt-3 text-[1rem] font-semibold text-ink-900">{t(`blocked.${key}.title`)}</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
          {t(`blocked.${key}.body`)}
        </p>
        {key === 'openRequest' && (
          <Link
            href="/commission"
            className="mt-4 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
          >
            {t('blocked.openRequest.cta')}
          </Link>
        )}
        {key === 'noDestination' && (
          /* ⚠️ `/profile/payout`. There is no `/profile/payout-details` route —
             the name reads right and 404s, and it is the ONE link somebody
             follows when they cannot withdraw at all. */
          <Link
            href={{ pathname: '/profile/payout', query: { from: 'commission' } }}
            className="mt-4 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
          >
            {t('blocked.noDestination.cta')}
          </Link>
        )}
      </section>,
      false,
    )
  }

  /* ---------------- step 1 — where it goes ---------------- */
  if (step === 'account') {
    return frame(
      <div className="animate-rise">
        <h2 className="text-sm font-medium text-ink-700">{t('toTitle')}</h2>

        <div
          className="mt-3 flex flex-col gap-2.5"
          role="radiogroup"
          aria-label={t('toTitle')}
        >
          {destinations.map((option) => {
            const selected = option.method === destination.method
            const Icon = option.method === 'crypto' ? Coins : Smartphone
            return (
              <button
                key={option.method}
                type="button"
                role="radio"
                aria-checked={selected}
                data-method={option.method}
                name="commission-destination"
                onClick={() => setMethod(option.method)}
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
                    option.method === 'crypto'
                      ? 'bg-teal-50 text-teal-600'
                      : 'bg-brand-50 text-brand-600',
                  )}
                >
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-semibold text-ink-900">
                    {option.title}
                  </span>
                  <span className="block truncate font-mono text-[0.75rem] text-ink-500">
                    {option.detail}
                  </span>
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

        <Link
          href={{ pathname: '/profile/payout', query: { from: 'commission' } }}
          className="mt-3 block text-[0.75rem] text-ink-400 hover:text-ink-600"
        >
          {t('manageHint')}
        </Link>

        {/* Changing where the money goes starts a 48-hour clock. Said on the
            screen that offers the change, rather than discovered by being
            refused two minutes later. */}
        <p className="mt-3 flex items-start gap-1.5 text-[0.6875rem] leading-snug text-ink-500">
          <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
          {t('cooloffNote')}
        </p>

        <button
          type="button"
          disabled={!destination}
          onClick={() => setStep('amount')}
          className="mt-5 w-full rounded-(--radius-input) bg-brand-600 px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
        >
          {t('continue')}
        </button>
      </div>,
    )
  }

  /* ---------------- step 2 — how much ---------------- */
  if (step === 'amount') {
    const tooSmall = amountMinor > 0 && amountMinor < minimumMinor
    const tooBig = amountMinor > balanceMinor
    const valid = amountMinor > 0 && !tooSmall && !tooBig
    const error = tooSmall
      ? t('errTooSmall', { amount: cedis(minimumMinor) })
      : tooBig
        ? t('errTooBig', { amount: cedis(balanceMinor) })
        : amountError

    return frame(
      <div className="animate-rise">
        <h2 className="text-sm font-medium text-ink-700">{t('amountTitle')}</h2>

        {/*
          `inputMode="decimal"` is what raises the number pad on a phone, and it
          stays on `type="text"` on purpose: `type="number"` silently drops a
          value the browser considers malformed mid-typing, which on an amount
          field means a figure that vanishes as it is being entered.
        */}
        <div className="relative mt-3">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[0.875rem] font-semibold text-ink-400"
          >
            GHS
          </span>
          <input
            id="cw-amount"
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => {
              /* Digits and one decimal point; nothing else reaches state. */
              setAmount(e.target.value.replace(/[^\d.]/g, ''))
              setAmountError(null)
            }}
            placeholder="0.00"
            aria-label={t('amountLabel')}
            aria-invalid={error ? true : undefined}
            className={cn(
              'h-14 w-full rounded-(--radius-input) border bg-surface pl-14 pr-4',
              'text-right text-[1.5rem] font-bold tabular-nums text-ink-900',
              'placeholder:text-ink-400 focus:outline-none',
              'transition-[border-color,box-shadow] duration-150',
              error
                ? 'border-danger-500 focus:border-danger-600 focus:shadow-[0_0_0_3px] focus:shadow-danger-500/12'
                : 'border-ink-200 hover:border-ink-300 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12',
            )}
          />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2 text-[0.75rem] text-ink-500">
          <span>{t('minimum', { amount: cedis(minimumMinor) })}</span>
          <span className="tabular-nums">{t('available', { amount: cedis(balanceMinor) })}</span>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
            {error}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          {(
            [
              ['min', minimumMinor],
              ['half', Math.floor(balanceMinor / 2)],
              ['max', balanceMinor],
            ] as const
          ).map(([key, minor]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setAmount((minor / 100).toFixed(2))
                setAmountError(null)
              }}
              disabled={minor <= 0 || minor > balanceMinor}
              className="flex-1 rounded-full border border-ink-200 px-2 py-1.5 text-[0.75rem] font-medium text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700 disabled:opacity-40"
            >
              {t(`quick.${key}`)}
            </button>
          ))}
        </div>

        {/* What will actually arrive, said on the screen where the amount is
            being chosen rather than one step later. */}
        {valid && feeMinor > 0 && (
          <p className="mt-4 text-[0.8125rem] text-ink-600">
            {t('afterFee', { net: cedis(netMinor), percent: String(feePercent) })}
          </p>
        )}

        <button
          type="button"
          disabled={!valid}
          onClick={() => setStep('confirm')}
          className="mt-5 w-full rounded-(--radius-input) bg-brand-600 px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
        >
          {t('continue')}
        </button>
      </div>,
    )
  }

  /* ---------------- step 3 — confirm ---------------- */
  if (step === 'confirm') {
    return frame(
      <div className="animate-rise">
        <h2 className="text-sm font-medium text-ink-700">{t('confirmHeading')}</h2>

        <div className="mt-3 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
          <dl className="divide-y divide-ink-100">
            {[
              { label: t('to'), value: destination.title },
              { label: t('amountRow'), value: cedis(amountMinor) },
              {
                label: t('feeAt', { percent: String(feePercent) }),
                value: feeMinor > 0 ? `− ${cedis(feeMinor)}` : t('feeFree'),
              },
              { label: t('youGet'), value: cedis(netMinor) },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <dt className="text-[0.8125rem] text-ink-500">{row.label}</dt>
                <dd className="text-right text-[0.8125rem] font-semibold tabular-nums text-ink-900">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-3 flex gap-2 text-[0.75rem] leading-relaxed text-ink-500">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
          {t('holdNote')}
        </p>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => setStep('amount')}
            className="flex-1 rounded-(--radius-input) border border-ink-300 px-4 py-3.5 text-[0.9375rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
          >
            {t('editAmount')}
          </button>
          <button
            type="button"
            onClick={() => {
              setPin('')
              setPinError(null)
              setPinBlocked(null)
              setStep('pin')
            }}
            className="flex-1 rounded-(--radius-input) bg-brand-600 px-4 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-500"
          >
            {/* `confirmCta`, not `confirm`: that one reads "Confirm
                withdrawal", which is the HEADING above this table. The button
                and the heading saying the same sentence twice is how the ads
                screen does not read. */}
            {t('confirmCta')}
          </button>
        </div>
      </div>,
    )
  }

  /* ---------------- step 4 — the PIN ---------------- */
  return frame(
    <div className="animate-rise flex flex-col items-center">
      {pinBlocked === 'no_pin' ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-warning-50 text-warning-600">
            <KeyRound aria-hidden className="size-6" />
          </span>
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('pinMissing')}</h2>
          <Link
            href="/profile/pin"
            className="rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
          >
            {t('setPin')}
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('pinTitle')}</h2>
          {/* What is being authorised, rather than the title again in smaller
              type. This is the last screen before the money moves, and the
              figure and the destination are the two things worth repeating
              here. */}
          <p className="mt-1 text-center text-[0.8125rem] text-ink-500">
            {t('pinFor', { amount: cedis(netMinor), account: destination.title })}
          </p>

          <div className="mt-6">
            <PinPad
              value={pin}
              onChange={onPin}
              disabled={submitting || pinBlocked === 'locked'}
              ariaLabel={t('pinTitle')}
            />
          </div>

          <p
            role={pinError ? 'alert' : undefined}
            className={cn(
              'mt-4 min-h-4 max-w-[34ch] text-center text-[0.8125rem] font-medium leading-snug',
              pinError ? 'text-danger-600' : 'text-ink-500',
            )}
          >
            {pinError ?? (submitting ? t('pinSubmitting') : '')}
          </p>
        </>
      )}
    </div>,
  )
}

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[0.8125rem] text-ink-500">{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          strong ? 'text-[1rem] font-bold text-ink-900' : 'text-[0.8125rem] text-ink-800',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
