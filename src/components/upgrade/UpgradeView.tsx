'use client'

import { useEffect, useState, useTransition } from 'react'

import { AlertCircle, CheckCircle2, Gem, Layers, Smartphone, Wallet, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  cancelTopupHold,
  previewPlanCoupon,
  purchasePlanWithBalance,
  startPaystackCheckout,
  startPlanTopupCheckout,
} from '@/app/[locale]/(app)/upgrade/actions'
import { CouponField, type AppliedCoupon } from '@/components/checkout/CouponField'
import { PlanCard } from '@/components/upgrade/PlanCard'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'
import type { HeldTopup } from '@/lib/payments/topup-hold'
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
  checkoutMethods,
  balancePurchaseEnabled,
  balancePoints,
  heldTopups = [],
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
  /** Whether the Tech Store payment hub is configured. False hides the pay
   *  button and the coupon field, because a coupon with nothing to buy is a
   *  form that cannot be submitted. It is NOT a question about a Paystack key:
   *  this app holds none, and the page asked the wrong one until 17 September
   *  2026. */
  checkoutEnabled: boolean
  /**
   * Which ways to pay the checkout lists, from the admin's payment settings.
   *
   * ⚠️ THESE ARE LABELS, NOT GATES. Nothing in this app talks to Paystack;
   * the hub owns the payment page and its own dashboard decides which
   * channels it accepts. Switching one off here stops us ADVERTISING it, and
   * the admin field says so in as many words, because a switch an operator
   * believes stops card payments and does not is worse than no switch.
   */
  checkoutMethods: { mobileMoney: boolean; card: boolean }
  /** Whether a plan may be bought from the account balance
   *  (`plan_balance_purchase_enabled`). The SQL refuses it when off as well. */
  balancePurchaseEnabled: boolean
  /** The buyer's points balance, for the "pay from balance" card. */
  balancePoints: number
  /** Unfinished part-balance checkouts still holding some of the balance. */
  heldTopups?: HeldTopup[]
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
  /* Which button started the transition, so only that one says it is busy. */
  const [paying, setPaying] = useState<'paystack' | 'balance' | 'topup' | null>(null)
  /* Open when "pay from balance" was pressed with too little balance: the
     sheet then says what is left and offers Paystack for it. */
  const [topupPrompt, setTopupPrompt] = useState(false)
  const [bought, setBought] = useState<string | null>(null)
  const router = useRouter()
  /* The applied coupon, if any. Cleared whenever the sheet opens on a
     different plan or a different amount: a code names ONE plan, and a
     discount left over from the last sheet would be a price the database
     refuses at the till. */
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null)

  /* What the sheet says a buyer can pay with. Empty is a real answer: if the
     operator has switched both off, the checkout promises nothing rather than
     naming a rail nobody at this end has agreed to. */
  const methods = [
    checkoutMethods.mobileMoney && { icon: Smartphone, label: t('checkout.momo') },
    checkoutMethods.card && { icon: Wallet, label: t('checkout.card') },
  ].filter((m): m is { icon: typeof Smartphone; label: string } => Boolean(m))

  /*
    Hands off to Paystack's hosted page. A full document navigation, not the
    client router — we are leaving the app for another origin.
  */
  const pay = (plan: Plan, amountMinor: number) => {
    setError(null)
    setPaying('paystack')
    startTransition(async () => {
      /* The AMOUNT sent is the one they chose inside the band, never the
         discounted figure: the coupon comes off in SQL, so a tampered request
         cannot buy a band it did not pay for. */
      const res = await startPaystackCheckout(plan.id, amountMinor, coupon?.code)
      if (!res.ok) {
        /* `errorKey` is the server naming a case it wants worded a particular
           way. Anything else falls back to the generic line rather than
           surfacing a message written for a log. */
        setError(res.errorKey === 'refused' ? t('checkout.refused') : t('checkout.failed'))
        setPaying(null)
        return
      }
      window.location.assign(res.authorizationUrl)
    })
  }

  /*
    Paying from the balance never leaves the app: the points are debited and
    the plan granted in one database transaction, then the page refreshes so
    the held plans and the balance both show the result.
  */
  const payFromBalance = (plan: Plan, amountMinor: number) => {
    setError(null)
    setPaying('balance')
    startTransition(async () => {
      const res = await purchasePlanWithBalance(plan.id, amountMinor, coupon?.code)
      setPaying(null)
      if (!res.ok) {
        setError(res.message || t('checkout.failed'))
        return
      }
      setSelected(null)
      setBought(t('checkout.balanceSuccess', { plan: plan.name }))
      router.refresh()
    })
  }

  /*
    Part from the balance, the rest through Paystack. The split shown in the
    prompt is an estimate of the one `start_plan_topup_payment` computes; the
    database decides, and sets the balance part aside before the buyer leaves.
  */
  const payTopup = (plan: Plan, amountMinor: number) => {
    setError(null)
    setPaying('topup')
    startTransition(async () => {
      const res = await startPlanTopupCheckout(plan.id, amountMinor, coupon?.code)
      if (!res.ok) {
        setError(
          res.errorKey === 'refused'
            ? t('checkout.refused')
            : res.errorKey
              ? t('checkout.failed')
              : res.message || t('checkout.failed'),
        )
        setPaying(null)
        return
      }
      window.location.assign(res.authorizationUrl)
    })
  }

  /* Closing an unfinished part-balance payment. The server asks the hub first,
     so "paid" is a real answer: the plan went through after all. */
  const [releasing, setReleasing] = useState<string | null>(null)
  const releaseHold = (paymentId: string) => {
    setError(null)
    setReleasing(paymentId)
    startTransition(async () => {
      const res = await cancelTopupHold(paymentId)
      setReleasing(null)
      if (!res.ok) {
        setError(res.message)
        return
      }
      setBought(res.outcome === 'paid' ? t('checkout.holdWasPaid') : t('checkout.holdReleased'))
      router.refresh()
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

      {heldTopups.map((held) => (
        <div
          key={held.id}
          className="mt-4 rounded-(--radius-card) border border-warning-500/25 bg-warning-50 px-4 py-3"
        >
          <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-warning-700">
            <Wallet aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('checkout.holdNotice', {
              amount: format.number(held.balanceMinor / 100, {
                style: 'currency',
                currency: held.currencyCode,
                minimumFractionDigits: 2,
              }),
            })}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2.5"
            disabled={pending}
            loading={releasing === held.id}
            onClick={() => releaseHold(held.id)}
          >
            {t('checkout.holdCancel')}
          </Button>
        </div>
      ))}

      {!selected && error && (
        <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}

      {bought && (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 rounded-(--radius-card) border border-success-500/30 bg-success-50 px-4 py-3 text-[0.8125rem] font-medium text-success-700"
        >
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          {bought}
        </p>
      )}

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
              recommended={!heldInfo && !plan.comingSoon && plan.slug === 'silver'}
              previousName={index === 0 ? freeName : plans[index - 1]!.name}
              previousDailyAdCap={
                index === 0 ? freeDailyAdCap : plans[index - 1]!.dailyAdCap
              }
              baseAdPoints={baseAdPoints}
              pointsPerCurrencyUnit={pointsPerCurrencyUnit}
              onChoose={(amountMinor) => {
                /* An announced plan has no checkout to open. The card does not
                   call this, and the database refuses the tier outright; this
                   is the third place the same rule is stated, and it is here
                   because the sheet is what would ask somebody for money. */
                if (plan.comingSoon) return
                /* A code belongs to one plan and one amount. Carrying one over
                   into the next sheet would show a price the till refuses. */
                setCoupon(null)
                setTopupPrompt(false)
                setError(null)
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

            {(checkoutEnabled || balancePurchaseEnabled) && (
              <CouponField
                currency={selected.plan.currencyCode}
                initialCode={initialCoupon}
                applied={coupon}
                disabled={pending}
                onApplied={setCoupon}
                preview={(value) => previewPlanCoupon(selected.plan.id, selected.amountMinor, value)}
              />
            )}

            {/* Paying from the balance. The points figure mirrors the SQL in
                `purchase_plan_with_balance` (charged amount x points per cedi,
                rounded), so what this card promises is what gets debited; the
                database still checks the balance itself. */}
            {balancePurchaseEnabled &&
              (() => {
                const chargedMinor = coupon?.chargedMinor ?? selected.amountMinor
                const costPoints = Math.round((chargedMinor * pointsPerCurrencyUnit) / 100)
                const enough = balancePoints >= costPoints
                /* Mirrors the SQL: whole pesewas the balance covers, the rest
                   is what Paystack is asked for. */
                const coveredMinor = Math.min(
                  chargedMinor,
                  Math.floor((balancePoints * 100) / pointsPerCurrencyUnit),
                )
                const remainingMinor = chargedMinor - coveredMinor
                const canTopUp = !enough && coveredMinor > 0 && checkoutEnabled
                const money = (minor: number) =>
                  format.number(minor / 100, {
                    style: 'currency',
                    currency: selected.plan.currencyCode,
                    minimumFractionDigits: 2,
                  })
                return (
                  <div
                    className={cn(
                      'mt-4 rounded-(--radius-card) border p-3.5 text-xs',
                      enough
                        ? 'border-success-500/30 bg-success-50'
                        : 'border-warning-500/25 bg-warning-50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-ink-700">
                        <Wallet
                          aria-hidden
                          className={cn('size-4 shrink-0', enough ? 'text-success-600' : 'text-warning-600')}
                        />
                        {t('checkout.yourBalance')}
                      </span>
                      <span className="font-semibold text-ink-900 tabular-nums">
                        {money(Math.floor((balancePoints * 100) / pointsPerCurrencyUnit))}
                        <span className="ml-1 text-[0.6875rem] font-normal text-ink-500">
                          ({t('checkout.points', { points: format.number(balancePoints) })})
                        </span>
                      </span>
                    </div>

                    {topupPrompt && canTopUp ? (
                      /* The prompt: what the balance covers, what is left, and
                         where the rest will be paid. */
                      <div role="alertdialog" aria-live="polite" className="mt-2.5">
                        <p className="text-[0.8125rem] font-semibold text-warning-700">
                          {t('checkout.topupTitle')}
                        </p>
                        <dl className="mt-2 flex flex-col gap-1 text-[0.75rem] text-ink-700">
                          <div className="flex justify-between gap-2">
                            <dt>{t('checkout.topupFromBalance')}</dt>
                            <dd className="font-medium tabular-nums">{money(coveredMinor)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t('checkout.topupRemaining')}</dt>
                            <dd className="font-semibold text-ink-900 tabular-nums">
                              {money(remainingMinor)}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-600">
                          {t('checkout.topupExplain')}
                        </p>
                        <Button
                          size="lg"
                          fullWidth
                          className="mt-3"
                          disabled={pending}
                          loading={pending && paying === 'topup'}
                          onClick={() => payTopup(selected.plan, selected.amountMinor)}
                        >
                          {t('checkout.topupPay', { amount: money(remainingMinor) })}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          fullWidth
                          className="mt-1.5"
                          disabled={pending}
                          onClick={() => setTopupPrompt(false)}
                        >
                          {t('checkout.topupCancel')}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p
                          className={cn(
                            'mt-1.5 text-[0.75rem] leading-relaxed',
                            enough ? 'text-ink-600' : 'font-medium text-warning-700',
                          )}
                        >
                          {enough
                            ? t('checkout.deductionNote', { points: format.number(costPoints) })
                            : canTopUp
                              ? t('checkout.topupHint', { amount: money(remainingMinor) })
                              : t('checkout.insufficientNote', {
                                  needed: format.number(Math.max(0, costPoints - balancePoints)),
                                  amount: money(remainingMinor),
                                })}
                        </p>
                        <Button
                          size="lg"
                          fullWidth
                          variant={checkoutEnabled ? 'secondary' : 'primary'}
                          className="mt-3"
                          disabled={(!enough && !canTopUp) || pending}
                          loading={pending && paying === 'balance'}
                          leadingIcon={<Wallet />}
                          onClick={() =>
                            enough
                              ? payFromBalance(selected.plan, selected.amountMinor)
                              : setTopupPrompt(true)
                          }
                        >
                          {t('checkout.payWithBalance', {
                            amount: format.number(chargedMinor / 100, {
                              style: 'currency',
                              currency: selected.plan.currencyCode,
                              maximumFractionDigits: coupon ? 2 : 0,
                            }),
                          })}
                        </Button>
                      </>
                    )}
                  </div>
                )
              })()}

            {methods.length > 0 && (
              <p className="mt-4 text-[0.75rem] font-semibold tracking-[0.04em] text-ink-500 uppercase">
                {t('checkout.payWith')}
              </p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {methods.map(({ icon: Icon, label }) => (
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

            {!checkoutEnabled && !balancePurchaseEnabled && (
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
                loading={pending && paying === 'paystack'}
                disabled={pending}
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
