'use client'

import { useState, useTransition } from 'react'

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  Gem,
  Lock,
  PauseCircle,
  Percent,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Vault,
  Wallet,
  X,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  claimVaultInvestmentAction,
  purchaseVaultWithBalanceAction,
  startVaultPaystackCheckout,
} from '@/app/[locale]/(app)/vault/actions'
import { Button } from '@/components/ui/Button'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { VaultInvestment, VaultPlan } from '@/lib/vault/data'

export function VaultView({
  vaultEnabled,
  plans,
  investments,
  userBalancePoints = 0,
  pointsRate = 100,
  checkoutEnabled,
}: {
  vaultEnabled: boolean
  plans: VaultPlan[]
  investments: VaultInvestment[]
  userBalancePoints?: number
  pointsRate?: number
  checkoutEnabled: boolean
}) {
  const t = useTranslations('vault')
  const format = useFormatter()
  const router = useRouter()

  const [selectedPlan, setSelectedPlan] = useState<VaultPlan | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [checkoutMode, setCheckoutMode] = useState<'paystack' | 'balance' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Metrics
  const activeInvestments = investments.filter((i) => i.status === 'active')
  const totalLockedMinor = activeInvestments.reduce((sum, i) => sum + i.amountMinor, 0)
  const totalExpectedReturnMinor = activeInvestments.reduce((sum, i) => sum + i.expectedReturnMinor, 0)
  const totalAccruedProfitMinor = activeInvestments.reduce((sum, i) => sum + i.expectedProfitMinor, 0)

  const userBalanceGhs = userBalancePoints / pointsRate

  const handleStartCheckout = (plan: VaultPlan) => {
    setError(null)
    setSuccessMessage(null)
    setSelectedPlan(plan)
  }

  const handleConfirmPaystack = () => {
    if (!selectedPlan) return
    setError(null)
    setCheckoutMode('paystack')

    startTransition(async () => {
      const res = await startVaultPaystackCheckout(selectedPlan.id)
      if (!res.ok) {
        setError(res.message ?? t('depositFailed'))
        setCheckoutMode(null)
        return
      }
      window.location.assign(res.authorizationUrl)
    })
  }

  const handleConfirmBalancePayment = () => {
    if (!selectedPlan) return
    setError(null)
    setCheckoutMode('balance')

    startTransition(async () => {
      const res = await purchaseVaultWithBalanceAction(selectedPlan.id)
      if (!res.ok) {
        setError(res.message ?? t('depositFailed'))
        setCheckoutMode(null)
        return
      }
      setSelectedPlan(null)
      setCheckoutMode(null)
      setSuccessMessage(t('checkout.balanceSuccess'))
      router.refresh()
    })
  }

  const handleClaim = (investmentId: string) => {
    setError(null)
    setSuccessMessage(null)
    setClaimingId(investmentId)

    startTransition(async () => {
      const res = await claimVaultInvestmentAction(investmentId)
      setClaimingId(null)
      if (!res.ok) {
        setError(res.message)
        return
      }
      setSuccessMessage(t('claimedSuccess', { points: res.points }))
      router.refresh()
    })
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 md:py-7">
      {/* Header ----------------------------------------------------------- */}
      <header className="animate-rise">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink-900 sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* Messages --------------------------------------------------------- */}
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-(--radius-card) border border-danger-500/30 bg-danger-50 p-3 text-[0.8125rem] font-medium text-danger-700">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-(--radius-card) border border-success-500/30 bg-success-50 p-3 text-[0.8125rem] font-medium text-success-700">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* What the user holds right now (Top Card matching UpgradeView) ---- */}
      <div
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className={cn(
          'animate-rise mt-5 rounded-(--radius-card) border p-4 sm:p-5',
          activeInvestments.length > 0
            ? 'border-violet-600/20 bg-violet-50 text-ink-900'
            : 'border-ink-200 bg-surface text-ink-900',
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full',
              activeInvestments.length > 0
                ? 'bg-violet-600/10 text-violet-600'
                : 'bg-ink-100 text-ink-500',
            )}
          >
            <Vault aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] font-semibold text-ink-900">
              {activeInvestments.length > 0
                ? t('holdingActiveVaults', { count: activeInvestments.length })
                : t('noActiveVaults')}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">
              {activeInvestments.length > 0
                ? t('holdingActiveHint')
                : t('noActiveHint')}
            </p>
          </div>
        </div>

        {activeInvestments.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label={t('stats.locked')}
              value={`GHS ${format.number(totalLockedMinor / 100, { minimumFractionDigits: 2 })}`}
            />
            <Stat
              label={t('stats.projectedProfit')}
              value={`+GHS ${format.number(totalAccruedProfitMinor / 100, { minimumFractionDigits: 2 })}`}
            />
            <Stat
              label={t('stats.totalMaturity')}
              value={`GHS ${format.number(totalExpectedReturnMinor / 100, { minimumFractionDigits: 2 })}`}
            />
          </dl>
        )}
      </div>

      {/* How Vault Works Explanation Banner ------------------------------- */}
      <div
        style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
        className="animate-rise mt-3 flex items-start gap-2.5 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3"
      >
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
        <p className="text-[0.8125rem] leading-relaxed text-ink-600">{t('howItWorks')}</p>
      </div>

      {/* User's Active Vaults Roster (If any) ----------------------------- */}
      {investments.length > 0 && (
        <section style={{ '--rise-delay': '0.12s' } as React.CSSProperties} className="animate-rise mt-6">
          <h2 className="text-base font-semibold text-ink-900">{t('myVaults.title')}</h2>
          <p className="text-xs text-ink-500">{t('myVaults.subtitle')}</p>

          <div className="mt-3 flex flex-col gap-3">
            {investments.map((inv) => {
              const startDate = new Date(inv.startedAt)
              const endDate = new Date(inv.endsAt)
              const now = new Date()
              const isMatured = now >= endDate
              const totalDays = inv.periodDays
              const diffMs = endDate.getTime() - now.getTime()
              const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
              const progressPercent = isMatured
                ? 100
                : Math.min(100, Math.max(0, Math.round(((totalDays - daysRemaining) / totalDays) * 100)))

              return (
                <div
                  key={inv.id}
                  className={cn(
                    'flex flex-col gap-4 rounded-(--radius-card) border p-4 sm:flex-row sm:items-center sm:justify-between',
                    inv.status === 'claimed'
                      ? 'border-ink-200 bg-surface/60 opacity-80'
                      : isMatured
                        ? 'border-amber-500/40 bg-amber-500/5 shadow-xs'
                        : 'border-violet-600/30 bg-surface shadow-xs',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold',
                          inv.status === 'claimed'
                            ? 'bg-ink-100 text-ink-500'
                            : isMatured
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-violet-50 text-violet-600',
                        )}
                      >
                        {inv.status === 'claimed' ? (
                          <CheckCircle2 className="size-4" />
                        ) : isMatured ? (
                          <Coins className="size-4" />
                        ) : (
                          <Lock className="size-4" />
                        )}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-ink-900">{inv.planName}</h3>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider',
                              inv.status === 'claimed'
                                ? 'bg-ink-100 text-ink-600'
                                : isMatured
                                  ? 'bg-amber-100 text-amber-800 animate-pulse'
                                  : 'bg-violet-100 text-violet-700',
                            )}
                          >
                            {inv.status === 'claimed'
                              ? t('status.claimed')
                              : isMatured
                                ? t('status.matured')
                                : t('status.active')}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {t('myVaults.deposit')}: GHS {format.number(inv.amountMinor / 100, { minimumFractionDigits: 2 })} •{' '}
                          +{inv.dailyReturnPercent}%/day for {inv.periodDays} days
                        </p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="flex justify-between text-[0.6875rem] text-ink-500">
                        <span>
                          {isMatured
                            ? t('myVaults.maturedOn', { date: format.dateTime(endDate, { dateStyle: 'medium' }) })
                            : t('myVaults.daysRemaining', { days: daysRemaining })}
                        </span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            inv.status === 'claimed'
                              ? 'bg-ink-400'
                              : isMatured
                                ? 'bg-amber-500'
                                : 'bg-violet-600',
                          )}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Return Amount & Claim Button */}
                  <div className="flex items-center justify-between border-t border-ink-100 pt-3 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                    <div className="text-left sm:text-right">
                      <span className="text-[0.6875rem] font-medium text-ink-500 uppercase">
                        {inv.status === 'claimed' ? t('myVaults.claimedPayout') : t('myVaults.maturityPayout')}
                      </span>
                      <p className="text-base font-bold text-ink-900">
                        GHS {format.number(inv.expectedReturnMinor / 100, { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[0.6875rem] font-medium text-emerald-600">
                        (+GHS {format.number(inv.expectedProfitMinor / 100, { minimumFractionDigits: 2 })} {t('profit')})
                      </p>
                    </div>

                    {inv.status === 'active' && isMatured && (
                      <Button
                        size="sm"
                        onClick={() => handleClaim(inv.id)}
                        disabled={isPending && claimingId === inv.id}
                        className="mt-2 bg-amber-600 text-white hover:bg-amber-700"
                        leadingIcon={<Sparkles className="size-3.5" />}
                      >
                        {isPending && claimingId === inv.id ? t('claiming') : t('claimBtn')}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Available Plans Grid (styled like PlanCard in Upgrade) ------------ */}
      <section style={{ '--rise-delay': '0.15s' } as React.CSSProperties} className="animate-rise mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{t('plans.title')}</h2>
            <p className="text-xs text-ink-500">{t('plans.subtitle')}</p>
          </div>
        </div>

        {!vaultEnabled ? (
          <div className="mt-4 flex items-center gap-3 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 p-4 text-warning-800">
            <PauseCircle className="size-5 shrink-0 text-warning-600" />
            <p className="text-xs leading-relaxed font-medium">{t('pausedBody')}</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan, idx) => {
              const priceGhs = plan.priceMinor / 100
              const dailyProfitGhs = priceGhs * (plan.dailyReturnPercent / 100)
              const totalProfitGhs = dailyProfitGhs * plan.periodDays
              const totalMaturityGhs = priceGhs + totalProfitGhs
              const isPopular = idx === 1

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col rounded-(--radius-card) border bg-surface p-5 transition-shadow',
                    isPopular
                      ? 'border-violet-600/40 shadow-[0_1px_2px_0_rgb(15_23_42/0.06),0_12px_28px_-16px_rgb(124_58_237/0.45)]'
                      : 'border-ink-200 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]',
                  )}
                >
                  {isPopular && (
                    <span className="absolute -top-2.5 left-5 rounded-full bg-violet-600 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-white">
                      {t('popular')}
                    </span>
                  )}

                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
                      {plan.name}
                    </h3>
                    <div className="text-right">
                      <p className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">
                        GHS {format.number(priceGhs, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-[0.6875rem] text-ink-500">
                        {plan.periodDays} {t('days')}
                      </p>
                    </div>
                  </div>

                  {plan.description && (
                    <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
                      {plan.description}
                    </p>
                  )}

                  {/* Benefits List (matching Upgrade PlanCard) */}
                  <ul className="mt-4 flex flex-1 flex-col gap-2">
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                        <Percent aria-hidden className="size-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.8125rem] font-medium leading-relaxed text-ink-700">
                          +{plan.dailyReturnPercent}% {t('dailyReturnRate')}
                        </span>
                        <span className="block text-[0.75rem] leading-snug text-ink-400">
                          +GHS {format.number(dailyProfitGhs, { minimumFractionDigits: 2 })} / day
                        </span>
                      </span>
                    </li>

                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                        <Clock aria-hidden className="size-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.8125rem] font-medium leading-relaxed text-ink-700">
                          {plan.periodDays} {t('days')} {t('lockDuration')}
                        </span>
                        <span className="block text-[0.75rem] leading-snug text-ink-400">
                          {t('lockDurationHint')}
                        </span>
                      </span>
                    </li>

                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                        <Coins aria-hidden className="size-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.8125rem] font-medium leading-relaxed text-ink-700">
                          GHS {format.number(totalProfitGhs, { minimumFractionDigits: 2 })} {t('netProfit')}
                        </span>
                        <span className="block text-[0.75rem] leading-snug text-ink-400">
                          {t('profitOnMaturity')}
                        </span>
                      </span>
                    </li>
                  </ul>

                  {/* Highlighted Maturity Box */}
                  <div className="mt-4 rounded-(--radius-card) border border-violet-600/30 bg-violet-50/50 p-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[0.75rem] font-medium text-ink-600">
                        {t('totalAtMaturity')}
                      </span>
                      <span className="text-[1.0625rem] font-bold text-violet-700 tabular-nums">
                        GHS {format.number(totalMaturityGhs, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-500">
                      GHS {format.number(priceGhs, { minimumFractionDigits: 2 })} deposit + GHS{' '}
                      {format.number(totalProfitGhs, { minimumFractionDigits: 2 })} profit
                    </p>
                  </div>

                  {/* Primary CTA */}
                  <div className="mt-4">
                    <Button
                      size="lg"
                      fullWidth
                      onClick={() => handleStartCheckout(plan)}
                    >
                      {t('plans.depositBtn')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <p className="mt-6 text-center text-[0.75rem] leading-relaxed text-ink-400">
        {t('footnote')}
      </p>

      {/* Checkout Sheet Modal with Dual Funding Options ------------------ */}
      {selectedPlan && (() => {
        const priceGhs = selectedPlan.priceMinor / 100
        const pricePoints = Math.round(priceGhs * pointsRate)
        const hasEnoughBalance = userBalancePoints >= pricePoints
        const missingPoints = Math.max(0, pricePoints - userBalancePoints)
        const missingGhs = (missingPoints / pointsRate).toFixed(2)
        const totalMaturityGhs = (selectedPlan.priceMinor + selectedPlan.priceMinor * (selectedPlan.dailyReturnPercent / 100) * selectedPlan.periodDays) / 100

        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={t('checkout.title', { plan: selectedPlan.name })}
            onClick={(e) => e.target === e.currentTarget && setSelectedPlan(null)}
          >
            <div className="w-full max-w-md rounded-t-(--radius-panel) bg-surface p-5 sm:rounded-(--radius-panel) sm:p-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[1.0625rem] font-semibold text-ink-900">
                    {t('checkout.title', { plan: selectedPlan.name })}
                  </h2>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-500">
                    {t('checkout.subtitle', { days: selectedPlan.periodDays })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlan(null)}
                  aria-label={t('checkout.close')}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>

              {/* Order Summary Rows */}
              <div className="mt-4 flex flex-col divide-y divide-ink-100 rounded-(--radius-card) border border-ink-200 bg-ink-50/70 text-xs">
                <div className="flex items-center justify-between p-3">
                  <span className="text-ink-600">{t('checkout.depositAmount')}</span>
                  <span className="font-semibold text-ink-900 tabular-nums">
                    GHS {format.number(priceGhs, { minimumFractionDigits: 2 })}
                    <span className="ml-1 text-[0.6875rem] font-normal text-ink-500">
                      ({format.number(pricePoints)} pts)
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between p-3">
                  <span className="text-ink-600">{t('totalAtMaturity')}</span>
                  <span className="font-bold text-violet-700 tabular-nums">
                    GHS {format.number(totalMaturityGhs, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Account Balance Card */}
              <div
                className={cn(
                  'mt-3 rounded-(--radius-card) border p-3 text-xs transition-colors',
                  hasEnoughBalance
                    ? 'border-emerald-500/25 bg-emerald-50/40 text-emerald-950'
                    : 'border-ink-200 bg-surface text-ink-700',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium text-ink-700">
                    <Wallet className={cn('size-4 shrink-0', hasEnoughBalance ? 'text-emerald-600' : 'text-ink-400')} />
                    {t('checkout.yourBalance')}
                  </span>
                  <span className="font-semibold text-ink-900 tabular-nums">
                    GHS {format.number(userBalanceGhs, { minimumFractionDigits: 2 })}
                    <span className="ml-1 text-[0.6875rem] font-normal text-ink-500">
                      ({format.number(userBalancePoints)} pts)
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-[0.6875rem] leading-normal text-ink-500">
                  {hasEnoughBalance
                    ? t('checkout.deductionNote', {
                        points: format.number(pricePoints),
                        ghs: format.number(priceGhs, { minimumFractionDigits: 2 }),
                      })
                    : t('checkout.insufficientNote', {
                        needed: format.number(missingPoints),
                        missingGhs,
                      })}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 flex flex-col gap-2.5">
                {/* Method 1: Account Balance Funding */}
                <Button
                  size="lg"
                  fullWidth
                  disabled={!hasEnoughBalance || isPending}
                  onClick={handleConfirmBalancePayment}
                  leadingIcon={<Sparkles className="size-4" />}
                >
                  {isPending && checkoutMode === 'balance'
                    ? t('checkout.payingWithBalance')
                    : t('checkout.payWithBalance', {
                        amount: format.number(priceGhs, { minimumFractionDigits: 2 }),
                      })}
                </Button>

                {/* Method 2: Paystack Checkout */}
                {checkoutEnabled && (
                  <Button
                    size="lg"
                    variant="secondary"
                    fullWidth
                    disabled={isPending}
                    onClick={handleConfirmPaystack}
                    trailingIcon={<ArrowRight className="size-4" />}
                  >
                    {isPending && checkoutMode === 'paystack'
                      ? t('initiatingPayment')
                      : t('checkout.payWithPaystack')}
                  </Button>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  fullWidth
                  disabled={isPending}
                  onClick={() => setSelectedPlan(null)}
                >
                  {t('checkout.cancel')}
                </Button>
              </div>
            </div>
          </div>
        )
      })()}
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
