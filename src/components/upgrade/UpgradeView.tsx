'use client'

import { useEffect, useState, useTransition } from 'react'

import { Gem, Layers, Smartphone, Wallet, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { startPaystackCheckout } from '@/app/[locale]/(app)/upgrade/actions'
import { PlanCard } from '@/components/upgrade/PlanCard'
import { Button } from '@/components/ui/Button'
import type { HeldPlan, Plan, ResolvedBenefits } from '@/lib/subscriptions/data'
import { cn } from '@/lib/cn'

/**
 * The Upgrade tab.
 *
 * Two things this screen has to get across, because both are unusual and both
 * cost money if misunderstood: plans STACK (holding two gives you both), and
 * each one runs for three months rather than renewing monthly.
 *
 * The benefits summary at the top is computed by the database, not here —
 * resolve_user_tier owns the combining rules, and a second implementation in
 * the UI would be a second place for them to disagree.
 */
export function UpgradeView({
  plans,
  held,
  benefits,
  freeDailyAdCap,
  pointsPerCurrencyUnit,
  checkoutEnabled,
}: {
  plans: Plan[]
  held: HeldPlan[]
  benefits: ResolvedBenefits | null
  /** The free allowance, so plans can say how many MORE ads they buy. */
  freeDailyAdCap: number
  /** Points to one cedi, for showing thresholds in money. */
  pointsPerCurrencyUnit: number
  /** False until mobile money and crypto checkout are wired up. */
  checkoutEnabled: boolean
}) {
  const t = useTranslations('upgrade')
  const format = useFormatter()
  const [selected, setSelected] = useState<Plan | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  /*
    Hands off to Paystack's hosted page. A full document navigation, not the
    client router — we are leaving the app for another origin.
  */
  const pay = (plan: Plan) => {
    setError(null)
    startTransition(async () => {
      const res = await startPaystackCheckout(plan.id)
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
        className="animate-rise mt-5 rounded-(--radius-card) border border-violet-600/20 bg-violet-50 p-4 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-600/10 text-violet-600">
            <Gem aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] font-semibold text-violet-700">
              {heldCount === 0 ? t('current.free') : t('current.holding', { count: heldCount })}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">
              {heldCount === 0 ? t('current.freeHint') : t('current.holdingHint')}
            </p>
          </div>
        </div>

        {benefits && (
          <dl className="mt-4 grid grid-cols-3 gap-2">
            <Stat
              label={t('current.dailyAds')}
              value={format.number(benefits.dailyAdCap)}
            />
            <Stat
              label={t('current.rate')}
              value={`+${Math.round((benefits.rewardMultiplier - 1) * 100)}%`}
            />
            <Stat
              label={t('current.payoutFrom')}
              value={format.number(benefits.redemptionMinimumPoints / pointsPerCurrencyUnit, {
                style: 'currency',
                currency: 'GHS',
                maximumFractionDigits: 0,
              })}
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
        className="animate-rise mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            held={heldByTier.has(plan.id)}
            endsAt={heldByTier.get(plan.id)?.endsAt ?? null}
            // The middle plan carries the badge: it is the one most people
            // should land on, and an unmarked grid makes everyone hesitate.
            recommended={!heldByTier.has(plan.id) && plan.slug === 'silver'}
            freeDailyAdCap={freeDailyAdCap}
            pointsPerCurrencyUnit={pointsPerCurrencyUnit}
            onChoose={() => setSelected(plan)}
          />
        ))}
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
          aria-label={t('checkout.title', { plan: selected.name })}
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <div className="w-full max-w-md rounded-t-(--radius-panel) bg-surface p-5 sm:rounded-(--radius-panel) sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[1.0625rem] font-semibold text-ink-900">
                  {t('checkout.title', { plan: selected.name })}
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-ink-500">
                  {t('checkout.subtitle', { months: 3 })}
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
              <span className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">
                {format.number(selected.priceMinor / 100, {
                  style: 'currency',
                  currency: selected.currencyCode,
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>

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
                onClick={() => pay(selected)}
              >
                {t('checkout.pay', {
                  amount: format.number(selected.priceMinor / 100, {
                    style: 'currency',
                    currency: selected.currencyCode,
                    maximumFractionDigits: 0,
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
