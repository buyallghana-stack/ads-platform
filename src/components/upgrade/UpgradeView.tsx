'use client'

import { useEffect, useState, useTransition } from 'react'

import { AlertCircle, Gem, Layers, Smartphone, Wallet, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { previewPlanCoupon, startPaystackCheckout } from '@/app/[locale]/(app)/upgrade/actions'
import { CouponField, type AppliedCoupon } from '@/components/checkout/CouponField'
import { PlanCard } from '@/components/upgrade/PlanCard'
import { Button } from '@/components/ui/Button'
import type { HeldPlan, Plan, ResolvedBenefits } from '@/lib/subscriptions/data'
import { cn } from '@/lib/cn'

/**
 * The Upgrade tab.
 *
 * Two things this screen has to get across, because both are unusual and both
 * cost money if misunderstood: plans STACK (holding two gives you both), and
 * each one runs for a fixed period rather than renewing monthly. That period
 * is `billing_period_days` on the plan and is currently 30 days on all five;
 * it is never assumed here, because it was once written into the checkout as
 * "3 months" and stayed there after the plans changed.
 *
 * The benefits summary at the top is computed by the database, not here —
 * resolve_user_tier owns the combining rules, and a second implementation in
 * the UI would be a second place for them to disagree.
 */
export function UpgradeView({
  plans,
  held,
  benefits,
  freeEarningOver = false,
  freeDailyAdCap,
  freeName,
  baseAdPoints,
  pointsPerCurrencyUnit,
  checkoutEnabled,
  initialCoupon,
}: {
  plans: Plan[]
  held: HeldPlan[]
  benefits: ResolvedBenefits | null
  freeEarningOver?: boolean
  /** The free allowance and its name, so the cheapest paid plan has a rung
   *  to compare against. Every plan after it compares to its predecessor. */
  freeDailyAdCap: number
  freeName: string
  /** What a typical ad is worth before any multiplier, for the previews. */
  baseAdPoints: number
  /** Points to one cedi. */
  pointsPerCurrencyUnit: number
  /** False until mobile money and crypto checkout are wired up. */
  checkoutEnabled: boolean
  /** From a shared link, `/upgrade?coupon=CODE`. */
  initialCoupon?: string | null
}) {
  const t = useTranslations('upgrade')
  const format = useFormatter()
  /* The plan AND what they chose to pay for it — the amount is half the
     product now, so it cannot be dropped between the card and the checkout. */
  const [selected, setSelected] = useState<{ plan: Plan; amountMinor: number } | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  /* The applied coupon, if any. Cleared whenever the sheet opens on a
     different plan or a different amount: a code names ONE plan, and a
     discount left over from the last sheet would be a price the database
     refuses at the till. */
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null)

  /*
    Hands off to Paystack's hosted page. A full document navigation, not the
    client router — we are leaving the app for another origin.
  */
  const pay = (plan: Plan, amountMinor: number) => {
    setError(null)
    startTransition(async () => {
      /* The AMOUNT sent is the one they chose inside the band, never the
         discounted figure: the coupon comes off in SQL, so a tampered request
         cannot buy a band it did not pay for. */
      const res = await startPaystackCheckout(plan.id, amountMinor, coupon?.code)
      if (!res.ok) {
        setError(res.message ?? t('checkout.failed'))
        return
      }
      window.location.assign(res.authorizationUrl)
    })
  }

  const heldByTier = new Map(held.map((h) => [h.tierId, h]))
  const heldCount = held.length

  // Esc closes the sheet, matching the notifications panel.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 md:py-7">
      <header className="animate-rise">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* What the user has right now ------------------------------------- */}
      <div
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className={cn(
          'animate-rise mt-5 rounded-(--radius-card) border p-4 sm:p-5',
          heldCount === 0 && freeEarningOver
            ? 'border-danger-500/30 bg-danger-50 text-ink-900'
            : 'border-violet-600/20 bg-violet-50 text-ink-900'
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full',
              heldCount === 0 && freeEarningOver
                ? 'bg-danger-500/15 text-danger-600'
                : 'bg-violet-600/10 text-violet-600'
            )}
          >
            {heldCount === 0 && freeEarningOver ? (
              <AlertCircle aria-hidden className="size-5" />
            ) : (
              <Gem aria-hidden className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-[0.875rem] font-semibold',
                heldCount === 0 && freeEarningOver ? 'text-danger-700' : 'text-violet-700'
              )}
            >
              {heldCount === 0
                ? freeEarningOver
                  ? t('current.freeExpired')
                  : t('current.free')
                : t('current.holding', { count: heldCount })}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">
              {heldCount === 0
                ? freeEarningOver
                  ? t('current.freeExpiredHint')
                  : t('current.freeHint')
                : t('current.holdingHint')}
            </p>
          </div>
        </div>

        {benefits && (
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <Stat
              label={t('current.dailyAds')}
              value={format.number(heldCount === 0 && freeEarningOver ? 0 : benefits.dailyAdCap)}
            />
            <Stat
              label={t('current.rate')}
              value={
                heldCount === 0 && freeEarningOver
                  ? t('current.paused')
                  : `+${Math.round((benefits.rewardMultiplier - 1) * 100)}%`
              }
            />
          </dl>
        )}
      </div>

      {/* How stacking works ---------------------------------------------- */}
      <div
        style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
        className="animate-rise mt-3 flex items-start gap-2.5 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3"
      >
        <Layers aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
        <p className="text-[0.8125rem] leading-relaxed text-ink-600">{t('stacking')}</p>
      </div>

      {/* Plans ------------------------------------------------------------ */}
      <div
        style={{ '--rise-delay': '0.15s' } as React.CSSProperties}
        className={cn(
          'animate-rise mt-5 grid gap-4',
          /* Six plans, and each card now carries a slider and a two-column
             preview. Five across a 1440px screen leaves ~170px a card, which
             is where "150 pts" and "GHS 4.50" start overlapping — so five is
             only offered on a screen that can actually seat them. */
          'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
        )}
      >
        {plans.map((plan, index) => {
          const heldInfo = heldByTier.get(plan.id)
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              held={!!heldInfo}
              amountPaidMinor={heldInfo?.amountMinor ?? null}
              endsAt={heldInfo?.endsAt ?? null}
              // The middle plan carries the badge: it is the one most people
              // should land on, and an unmarked grid makes everyone hesitate.
              recommended={!heldInfo && plan.slug === 'silver'}
              previousName={index === 0 ? freeName : plans[index - 1]!.name}
              previousDailyAdCap={
                index === 0 ? freeDailyAdCap : plans[index - 1]!.dailyAdCap
              }
              baseAdPoints={baseAdPoints}
              pointsPerCurrencyUnit={pointsPerCurrencyUnit}
              onChoose={(amountMinor) => {
                /* A code belongs to one plan and one amount. Carrying one over
                   into the next sheet would show a price the till refuses. */
                setCoupon(null)
                setSelected({ plan, amountMinor })
              }}
            />
          )
        })}
      </div>

      <p className="mt-4 text-center text-[0.75rem] leading-relaxed text-ink-400">
        {t('footnote')}
      </p>

      {/* Checkout sheet --------------------------------------------------- */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t('checkout.title', { plan: selected.plan.name })}
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <div className="w-full max-w-md rounded-t-(--radius-panel) bg-surface p-5 sm:rounded-(--radius-panel) sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[1.0625rem] font-semibold text-ink-900">
                  {t('checkout.title', { plan: selected.plan.name })}
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-ink-500">
                  {/* ⚠️ THE PERIOD COMES FROM THE PLAN. This said "3 months"
                      with the 3 TYPED IN, while every plan on sale runs for 30
                      days: the checkout promised three times what it sold, on
                      the last screen before somebody pays. The card beside it
                      has always read `plan.periodDays`, so the two screens
                      disagreed with each other as well.

                      Days rather than months, like the card: the operator sets
                      `billing_period_days` per plan, and any figure derived by
                      dividing it is a rounding waiting to become another false
                      promise. */}
                  {t('checkout.subtitle', { days: selected.plan.periodDays })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t('checkout.close')}
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3">
              <span className="text-[0.8125rem] text-ink-600">{t('checkout.total')}</span>
              <span className="flex items-baseline gap-2">
                {/* The old price stays visible beside the new one. A total that
                    simply changes leaves somebody wondering whether the code
                    worked or the plan did. */}
                {coupon && (
                  <span className="text-[0.8125rem] text-ink-400 line-through">
                    {format.number(selected.amountMinor / 100, {
                      style: 'currency',
                      currency: selected.plan.currencyCode,
                      maximumFractionDigits: 0,
                    })}
                  </span>
                )}
                <span className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">
                  {format.number((coupon?.chargedMinor ?? selected.amountMinor) / 100, {
                    style: 'currency',
                    currency: selected.plan.currencyCode,
                    maximumFractionDigits: coupon ? 2 : 0,
                  })}
                </span>
              </span>
            </div>

            {/* The plan is unchanged by the discount: a code names its tier, so
                it takes money off the price and leaves the band alone. Said
                here because a struck-through total otherwise reads as "you are
                buying less". */}
            {coupon && (
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-500">
                {t('checkout.stillFullPlan', { plan: selected.plan.name })}
              </p>
            )}

            {checkoutEnabled && (
              <CouponField
                currency={selected.plan.currencyCode}
                initialCode={initialCoupon}
                applied={coupon}
                disabled={pending}
                onApplied={setCoupon}
                preview={(value) => previewPlanCoupon(selected.plan.id, selected.amountMinor, value)}
              />
            )}

            <p className="mt-4 text-[0.75rem] font-semibold tracking-[0.04em] text-ink-500 uppercase">
              {t('checkout.payWith')}
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {[
                { icon: Smartphone, label: t('checkout.momo') },
                { icon: Wallet, label: t('checkout.card') },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className={cn(
                    'flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3',
                    !checkoutEnabled && 'opacity-60',
                  )}
                >
                  <span className="grid size-9 place-items-center rounded-full bg-ink-100 text-ink-500">
                    <Icon aria-hidden className="size-4.5" />
                  </span>
                  <span className="text-[0.875rem] font-medium text-ink-700">{label}</span>
                </div>
              ))}
            </div>

            {/* Who the money actually goes to. Required, not decorative: the name
                on the payment page and on the bank statement is the Tech
                Store's, because both products sit on one Paystack account that
                Paystack asked to be theirs. Somebody who does not expect that
                name reads it as fraud and charges it back. The name is a
                translation key rather than a literal so it can be corrected
                without a deploy of new code. */}
            <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-500">
              {t('checkout.processedBy', { merchant: t('checkout.merchantName') })}
            </p>

            {!checkoutEnabled && (
              <div
                className={cn(
                  'mt-4 rounded-(--radius-card) border px-4 py-3',
                  'border-warning-500/25 bg-warning-50',
                )}
              >
                <p className="text-[0.8125rem] leading-relaxed text-warning-700">
                  {t('checkout.notYet')}
                </p>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 text-[0.8125rem] font-medium text-danger-600">
                {error}
              </p>
            )}

            {checkoutEnabled && (
              <Button
                size="lg"
                fullWidth
                className="mt-4"
                loading={pending}
                onClick={() => pay(selected.plan, selected.amountMinor)}
              >
                {t('checkout.pay', {
                  amount: format.number((coupon?.chargedMinor ?? selected.amountMinor) / 100, {
                    style: 'currency',
                    currency: selected.plan.currencyCode,
                    maximumFractionDigits: coupon ? 2 : 0,
                  }),
                })}
              </Button>
            )}

            <Button
              variant="secondary"
              size="lg"
              fullWidth
              className="mt-2.5"
              disabled={pending}
              onClick={() => setSelected(null)}
            >
              {t('checkout.back')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-(--radius-input) bg-surface/70 px-3 py-2 text-center">
      <dt className="text-[0.6875rem] leading-tight text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
        {value}
      </dd>
    </div>
  )
}
