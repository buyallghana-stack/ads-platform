'use client'

import { useState, useTransition } from 'react'

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  Lock,
  PauseCircle,
  Percent,
  Sparkles,
  TrendingUp,
  Vault,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { claimVaultInvestmentAction, startVaultPaystackCheckout } from '@/app/[locale]/(app)/vault/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { VaultInvestment, VaultPlan } from '@/lib/vault/data'

export function VaultView({
  vaultEnabled,
  plans,
  investments,
  checkoutEnabled,
}: {
  vaultEnabled: boolean
  plans: VaultPlan[]
  investments: VaultInvestment[]
  checkoutEnabled: boolean
}) {
  const t = useTranslations('vault')
  const format = useFormatter()
  const router = useRouter()

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Metrics
  const activeInvestments = investments.filter((i) => i.status === 'active')
  const totalLockedMinor = activeInvestments.reduce((sum, i) => sum + i.amountMinor, 0)
  const totalExpectedReturnMinor = activeInvestments.reduce((sum, i) => sum + i.expectedReturnMinor, 0)
  const totalAccruedProfitMinor = activeInvestments.reduce((sum, i) => sum + i.expectedProfitMinor, 0)

  const handleDeposit = (planId: string) => {
    setError(null)
    setSuccessMessage(null)
    setSelectedPlanId(planId)

    startTransition(async () => {
      const res = await startVaultPaystackCheckout(planId)
      if (!res.ok) {
        setError(res.message ?? t('depositFailed'))
        setSelectedPlanId(null)
        return
      }
      window.location.assign(res.authorizationUrl)
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

  if (!vaultEnabled) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-warning-50 text-warning-600 ring-8 ring-warning-500/15">
            <PauseCircle aria-hidden className="size-6" />
          </span>
          <h1 className="text-xl font-semibold text-ink-900">{t('pausedTitle')}</h1>
          <p className="max-w-[42ch] text-[0.875rem] leading-relaxed text-ink-500">
            {t('pausedBody')}
          </p>
          <Link href="/dashboard">
            <Button size="md" variant="secondary" className="mt-2">
              {t('backToDashboard')}
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 md:py-7">
      {/* Header */}
      <header className="animate-rise">
        <div className="flex items-center gap-2 text-brand-600">
          <Vault className="size-5" />
          <span className="text-xs font-bold uppercase tracking-wider">{t('badge')}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-ink-900 sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-2xl text-[0.875rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* Messages */}
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

      {/* Portfolio Stats */}
      {investments.length > 0 && (
        <div
          style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
          className="animate-rise mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between text-ink-500">
              <span className="text-xs font-medium uppercase tracking-wider">{t('stats.locked')}</span>
              <Lock className="size-4 text-brand-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-ink-900">
              GHS {format.number(totalLockedMinor / 100, { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {t('stats.activeCount', { count: activeInvestments.length })}
            </p>
          </div>

          <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between text-ink-500">
              <span className="text-xs font-medium uppercase tracking-wider">{t('stats.projectedProfit')}</span>
              <TrendingUp className="size-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-emerald-600">
              +GHS {format.number(totalAccruedProfitMinor / 100, { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">{t('stats.guaranteedReturn')}</p>
          </div>

          <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between text-ink-500">
              <span className="text-xs font-medium uppercase tracking-wider">{t('stats.totalMaturity')}</span>
              <Coins className="size-4 text-amber-500" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-tight text-ink-900">
              GHS {format.number(totalExpectedReturnMinor / 100, { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">{t('stats.principalAndProfit')}</p>
          </div>
        </div>
      )}

      {/* User's Active & Matured Vaults */}
      {investments.length > 0 && (
        <section style={{ '--rise-delay': '0.1s' } as React.CSSProperties} className="animate-rise mt-8">
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
                        : 'border-brand-500/30 bg-surface shadow-xs',
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
                              : 'bg-brand-50 text-brand-600',
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
                                  : 'bg-brand-100 text-brand-700',
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
                          {inv.dailyReturnPercent}%/day for {inv.periodDays} days
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
                                : 'bg-brand-600',
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

      {/* Available Vault Plans */}
      <section style={{ '--rise-delay': '0.15s' } as React.CSSProperties} className="animate-rise mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{t('plans.title')}</h2>
            <p className="text-xs text-ink-500">{t('plans.subtitle')}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const priceGhs = plan.priceMinor / 100
            const dailyReturnGhs = priceGhs * (plan.dailyReturnPercent / 100)
            const totalProfitGhs = dailyReturnGhs * plan.periodDays
            const totalMaturityGhs = priceGhs + totalProfitGhs
            const isSelected = selectedPlanId === plan.id && isPending

            return (
              <Card
                key={plan.id}
                className="relative flex flex-col justify-between overflow-hidden border-ink-200 bg-surface p-5 shadow-sm transition-all hover:border-brand-500/50 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-ink-900">{plan.name}</h3>
                      <p className="mt-0.5 text-xs text-ink-500">{plan.description}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                      <Percent className="size-3" />
                      {plan.dailyReturnPercent}% / day
                    </span>
                  </div>

                  {/* Pricing and Duration */}
                  <div className="mt-4 rounded-(--radius-card) border border-ink-100 bg-ink-50/50 p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-ink-500">{t('plans.depositPrice')}</span>
                      <span className="text-lg font-extrabold text-ink-900">
                        GHS {format.number(priceGhs, { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-ink-600 border-t border-ink-100/80 pt-2">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3 text-ink-400" />
                        {t('plans.duration')}
                      </span>
                      <span className="font-semibold text-ink-900">
                        {plan.periodDays} {t('days')}
                      </span>
                    </div>
                  </div>

                  {/* Return Breakdown */}
                  <dl className="mt-4 flex flex-col gap-1.5 text-xs">
                    <div className="flex justify-between text-ink-600">
                      <span>{t('plans.dailyEarn')}</span>
                      <span className="font-medium text-emerald-600">
                        +GHS {format.number(dailyReturnGhs, { minimumFractionDigits: 2 })} / day
                      </span>
                    </div>
                    <div className="flex justify-between text-ink-600">
                      <span>{t('plans.totalProfit')}</span>
                      <span className="font-medium text-emerald-600">
                        +GHS {format.number(totalProfitGhs, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-ink-100 pt-1.5 font-bold text-ink-900">
                      <span>{t('plans.totalReturn')}</span>
                      <span className="text-brand-700">
                        GHS {format.number(totalMaturityGhs, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </dl>
                </div>

                <div className="mt-5">
                  <Button
                    size="md"
                    fullWidth
                    onClick={() => handleDeposit(plan.id)}
                    disabled={isPending || !checkoutEnabled}
                    className="bg-brand-600 text-white hover:bg-brand-700"
                    trailingIcon={<ArrowRight className="size-4" />}
                  >
                    {isSelected ? t('initiatingPayment') : t('plans.depositBtn')}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
