'use client'

import { useMemo, useState, useTransition } from 'react'

import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  requestCommissionWithdrawal,
  type CommissionWithdrawResult,
} from '@/app/[locale]/(affiliate)/commission/withdraw/actions'
import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * Requesting a commission payout.
 *
 * ── NOT THE POINTS WIZARD ──
 *
 * The points withdrawal is a five-step wizard because points are not money: it
 * has to explain the peg, show a tier minimum that varies by plan, and convert
 * before it can state a figure. Commission is already cedis. There is one
 * amount, one fee and one destination, so it is one screen — and building it on
 * the points wizard would have meant a component that can render a points
 * balance inside the affiliate business, which is exactly what D27 forbids.
 *
 * ── THE NET IS THE HEADLINE ──
 *
 * What lands in somebody's wallet is `amount − fee`, and that is the figure
 * they will check the transfer against. The requested amount is shown, but
 * smaller and above it, so nobody confirms a number they will not receive.
 *
 * ── THE FEE IS SHOWN BEFORE CONFIRMING, NEVER AFTER ──
 *
 * It is frozen onto the row at request time, so the figure here is the figure
 * charged. Discovering it in the statement afterwards is the version of this
 * screen that generates a complaint.
 */

type Destination = {
  method: 'mobile_money' | 'crypto'
  title: string
  /** Already masked upstream — this component never sees a full number. */
  detail: string
}

export function CommissionWithdraw({
  balanceMinor,
  minimumMinor,
  feePercent,
  destination,
  payoutsEnabled,
  openRequest,
}: {
  balanceMinor: number
  minimumMinor: number
  feePercent: number
  destination: Destination | null
  payoutsEnabled: boolean
  /** One at a time, by unique index. Said here rather than discovered by
   *  filling the form in and being refused by a constraint. */
  openRequest: boolean
}) {
  const t = useTranslations('affiliate.withdraw')

  const [amount, setAmount] = useState('')
  const [pin, setPin] = useState('')
  const [stage, setStage] = useState<'amount' | 'confirm'>('amount')
  const [result, setResult] = useState<CommissionWithdrawResult | null>(null)
  const [pending, startTransition] = useTransition()

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

  const tooSmall = amountMinor > 0 && amountMinor < minimumMinor
  const tooBig = amountMinor > balanceMinor
  const valid = amountMinor > 0 && !tooSmall && !tooBig

  const submit = () => {
    startTransition(async () => {
      const outcome = await requestCommissionWithdrawal({ amountMinor, pin })
      setResult(outcome)
      if (!outcome.ok) setPin('')
    })
  }

  /* ---------------- done ---------------- */
  if (result?.ok) {
    return (
      <section className="rounded-(--radius-panel) border border-success-500/30 bg-success-50 p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-14 place-items-center rounded-full bg-success-500/15 text-success-600"
        >
          <CheckCircle2 className="size-7" />
        </span>
        <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">{t('done.title')}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-600">
          {t('done.body')}
        </p>

        <dl className="mx-auto mt-5 max-w-xs space-y-2 text-left">
          <Row label={t('done.reference')} value={result.reference} mono />
          <Row label={t('requested')} value={cedis(result.amountMinor)} />
          <Row label={t('fee')} value={`− ${cedis(result.feeMinor)}`} />
          <Row label={t('done.youGet')} value={cedis(result.netMinor)} strong />
          {/* Crypto is denominated in the COIN, not in cedis — locked operator
              rule. The amount is frozen on the row, so this is what will be
              sent whatever the price does between now and payment. */}
          {result.coin && result.coinAmount !== undefined && (
            <Row
              label={t('done.inCoin', { coin: result.coin })}
              value={String(result.coinAmount)}
              strong
            />
          )}
        </dl>

        <Link
          href="/commission"
          className="mt-6 inline-flex rounded-(--radius-input) bg-brand-600 px-5 py-3 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          {t('done.back')}
        </Link>
      </section>
    )
  }

  /* ----------------  not enough yet  ----------------
     Its own screen, above the other blocked states, because it is the only one
     that is a matter of TIME rather than of something being wrong. The bar and
     the shortfall are the same answer the ads wizard gives on points, and the
     way in is the shop rather than a dead end: what closes this gap is another
     sale, so the button goes where the products are.

     ⚠️ Reachable at all only because the panel's Withdraw button is no longer
     hidden below the minimum. It used to fall through to the FORM, which
     accepted an amount and then refused it at Continue — the same answer three
     taps later, and the reason the operator could not find the flow. */
  if (payoutsEnabled && destination && !openRequest && balanceMinor < minimumMinor) {
    const shortMinor = minimumMinor - balanceMinor
    return (
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
      </section>
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
    return (
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
          <Link
            href="/profile/payout"
            className="mt-4 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
          >
            {t('blocked.noDestination.cta')}
          </Link>
        )}
      </section>
    )
  }

  /* ---------------- the form ---------------- */
  return (
    <div className="flex flex-col gap-4">
      {result && !result.ok && <Refusal result={result} />}

      <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5">
        <label htmlFor="cw-amount" className="block text-[0.8125rem] font-medium text-ink-700">
          {t('amountLabel')}
        </label>

        <div className="mt-2 flex items-center gap-2 rounded-(--radius-input) border border-ink-200 px-3 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/25">
          <span className="text-[0.9375rem] font-semibold text-ink-500">GHS</span>
          <input
            id="cw-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setStage('amount')
            }}
            placeholder="0.00"
            /* 16px on touch, always. Mobile Safari zooms the page for anything
               smaller and never zooms back out. */
            className="w-full bg-transparent py-3 text-[1.25rem] font-semibold tabular-nums text-ink-900 placeholder:text-ink-300 focus:outline-none pointer-coarse:text-base"
          />
          <button
            type="button"
            onClick={() => setAmount((balanceMinor / 100).toFixed(2))}
            className="shrink-0 rounded-full bg-ink-100 px-2.5 py-1 text-[0.75rem] font-semibold text-ink-700 transition-colors hover:bg-ink-200"
          >
            {t('all')}
          </button>
        </div>

        <p className="mt-1.5 flex flex-wrap justify-between gap-2 text-[0.75rem] text-ink-500">
          <span>{t('available', { amount: cedis(balanceMinor) })}</span>
          <span>{t('minimum', { amount: cedis(minimumMinor) })}</span>
        </p>

        {tooSmall && (
          <p role="alert" className="mt-2 text-[0.8125rem] text-danger-600">
            {t('errTooSmall', { amount: cedis(minimumMinor) })}
          </p>
        )}
        {tooBig && (
          <p role="alert" className="mt-2 text-[0.8125rem] text-danger-600">
            {t('errTooBig', { amount: cedis(balanceMinor) })}
          </p>
        )}

        {/* The arithmetic, before confirming. */}
        {valid && (
          <dl className="mt-4 space-y-2 border-t border-ink-200 pt-4">
            <Row label={t('requested')} value={cedis(amountMinor)} />
            <Row
              label={t('feeAt', { percent: String(feePercent) })}
              value={`− ${cedis(feeMinor)}`}
            />
            <Row label={t('youGet')} value={cedis(netMinor)} strong />
          </dl>
        )}

        <div className="mt-4 flex items-center gap-3 rounded-(--radius-card) bg-ink-50 px-3.5 py-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600/15 text-brand-700"
          >
            <Wallet className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.75rem] text-ink-500">{t('sendingTo')}</p>
            <p className="truncate text-[0.8125rem] font-medium text-ink-900">
              {destination.title}
            </p>
            <p className="truncate font-mono text-[0.75rem] text-ink-500">{destination.detail}</p>
          </div>
          {/* ⚠️ `/profile/payout`. There is no `/profile/payout-details` route —
              the name reads right and 404s, and it is the ONE link somebody
              follows when they cannot withdraw at all. */}
          <Link
            href="/profile/payout"
            className="ml-auto shrink-0 text-[0.75rem] font-semibold text-brand-700 hover:underline"
          >
            {t('change')}
          </Link>
        </div>

        {/* Changing the destination starts a 48-hour clock. Said here, on the
            screen with the "Change" link, rather than discovered by being
            refused two minutes later. */}
        <p className="mt-2 flex items-start gap-1.5 text-[0.6875rem] leading-snug text-ink-500">
          <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
          {t('cooloffNote')}
        </p>
      </section>

      {stage === 'amount' ? (
        <button
          type="button"
          disabled={!valid}
          onClick={() => setStage('confirm')}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-(--radius-input) px-5 py-3.5',
            'text-[0.9375rem] font-semibold transition-colors',
            valid
              ? 'bg-brand-600 text-white hover:bg-brand-500'
              : 'cursor-not-allowed bg-ink-100 text-ink-400',
          )}
        >
          {t('continue')}
          <ArrowRight aria-hidden className="size-4" />
        </button>
      ) : (
        <section className="rounded-(--radius-panel) border border-brand-600/30 bg-brand-50 p-5">
          <p className="text-[0.875rem] font-semibold text-ink-900">
            {t('confirmTitle', { amount: cedis(netMinor) })}
          </p>
          <label htmlFor="cw-pin" className="mt-3 block text-[0.8125rem] text-ink-600">
            {t('pinLabel')}
          </label>
          <input
            id="cw-pin"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="mt-2 w-full max-w-[10rem] rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-3 text-center text-[1.25rem] font-semibold tracking-[0.5em] tabular-nums text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 pointer-coarse:text-base"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pin.length !== 4 || pending}
              onClick={submit}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-(--radius-input) px-5 py-3',
                'text-[0.875rem] font-semibold transition-colors',
                pin.length === 4 && !pending
                  ? 'bg-brand-600 text-white hover:bg-brand-500'
                  : 'cursor-not-allowed bg-ink-100 text-ink-400',
              )}
            >
              {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {t('confirm')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStage('amount')
                setPin('')
              }}
              className="rounded-(--radius-input) border border-ink-300 px-4 py-3 text-[0.875rem] font-semibold text-ink-700 transition-colors hover:border-ink-400"
            >
              {/* Not `back` — that one is the link out to the earnings screen,
                  and reusing it labelled this button "Earnings", which reads
                  like leaving rather than changing the amount. */}
              {t('editAmount')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string
  value: string
  strong?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[0.8125rem] text-ink-500">{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          mono && 'font-mono',
          strong ? 'text-[1rem] font-bold text-ink-900' : 'text-[0.8125rem] text-ink-800',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** Every refusal gets its own sentence. A single "something went wrong" on a
 *  money screen is the version of this that generates a support ticket. */
function Refusal({ result }: { result: Extract<CommissionWithdrawResult, { ok: false }> }) {
  const t = useTranslations('affiliate.withdraw')

  const message =
    result.reason === 'wrong'
      ? t('pinWrong', { n: result.attemptsLeft })
      : result.reason === 'locked'
        ? t('pinLocked')
        : result.reason === 'no_pin'
          ? t('pinMissing')
          : result.reason === 'refused'
            ? result.code === 'already_open'
              ? t('alreadyOpen')
              : result.code === 'unknown'
                ? /* Never `detail` here. An unclassified failure is by
                     definition a message nobody wrote for a reader — a
                     constraint name, a type error — and a money screen is the
                     last place to print one. */
                  t('failed')
                : /* The database writes the rest in plain English and two of
                     them carry the actual number — the minimum, the balance —
                     so its own words beat anything this layer could
                     substitute. The code only decides the tone. */
                  result.detail
            : t('failed')

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 px-4 py-3"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4.5 shrink-0 text-danger-600" />
      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-snug text-ink-900">{message}</p>
        {result.reason === 'no_pin' && (
          <Link
            href="/profile/pin"
            className="mt-1 inline-block text-[0.8125rem] font-semibold text-brand-700 hover:underline"
          >
            {t('setPin')}
          </Link>
        )}
      </div>
    </div>
  )
}
