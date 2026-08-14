'use client'

import { useMemo, useState, useTransition } from 'react'

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  Edit2,
  Lock,
  Percent,
  Plus,
  Power,
  Trash2,
  TrendingUp,
  Vault,
  X,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  deleteVaultPlanAction,
  saveVaultPlanAction,
  toggleVaultEnabledAction,
  type VaultPlanInput,
} from '@/app/[locale]/admin/(super)/vault/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { VaultInvestment, VaultPlan } from '@/lib/vault/data'

import { StatusDot } from './AdminChrome'
import { Field, SwitchRow, inputClass } from './FormBits'

export function VaultBoard({
  vaultEnabled,
  plans,
  investments,
}: {
  vaultEnabled: boolean
  plans: VaultPlan[]
  investments: (VaultInvestment & { userEmail?: string; userFullName?: string })[]
}) {
  const t = useTranslations('admin.vault')
  const format = useFormatter()
  const router = useRouter()

  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState<'plans' | 'investments'>('plans')
  const [editing, setEditing] = useState<VaultPlan | 'new' | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Metrics
  const activeInvestments = investments.filter((i) => i.status === 'active')
  const totalLockedMinor = activeInvestments.reduce((sum, i) => sum + i.amountMinor, 0)
  const totalClaimedPoints = investments
    .filter((i) => i.status === 'claimed')
    .reduce((sum, i) => sum + (i.claimedPoints ?? 0), 0)

  const handleToggleGlobal = () => {
    setFeedback(null)
    startTransition(async () => {
      const res = await toggleVaultEnabledAction(!vaultEnabled)
      if (!res.ok) {
        setFeedback({ type: 'error', message: res.message ?? 'Failed to toggle vault status' })
        return
      }
      setFeedback({
        type: 'success',
        message: !vaultEnabled ? t('vaultEnabledMsg') : t('vaultDisabledMsg'),
      })
      router.refresh()
    })
  }

  const handleDeletePlan = (planId: string) => {
    if (!confirm(t('confirmDelete') || 'Are you sure you want to delete or deactivate this plan?')) return
    setFeedback(null)

    startTransition(async () => {
      const res = await deleteVaultPlanAction(planId)
      if (!res.ok) {
        setFeedback({ type: 'error', message: res.message ?? 'Failed to delete plan' })
        return
      }
      setFeedback({ type: 'success', message: res.message ?? t('planDeletedMsg') })
      router.refresh()
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{t('title')}</h1>
          <p className="text-sm text-ink-500">{t('subtitle')}</p>
        </div>

        {/* Global Toggle Switch */}
        <div className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-2 shadow-xs">
          <div className="flex items-center gap-2 px-2">
            <StatusDot tone={vaultEnabled ? 'success' : 'neutral'}>
              <span className="text-xs font-semibold text-ink-800">
                {vaultEnabled ? t('globalActive') : t('globalPaused')}
              </span>
            </StatusDot>
          </div>
          <Button
            size="sm"
            variant={vaultEnabled ? 'danger' : 'primary'}
            disabled={isPending}
            onClick={handleToggleGlobal}
            leadingIcon={<Power className="size-3.5" />}
          >
            {vaultEnabled ? t('pauseVault') : t('enableVault')}
          </Button>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          role="alert"
          className={cn(
            'flex items-center justify-between gap-2 rounded-(--radius-card) border p-3.5 text-xs font-medium',
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-50 text-emerald-800'
              : 'border-danger-500/30 bg-danger-50 text-danger-800',
          )}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <AlertCircle className="size-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 hover:bg-black/5 text-ink-500"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-ink-200 bg-surface p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-[0.6875rem] sm:text-xs font-medium uppercase tracking-wider">
              {t('metrics.totalPlans')}
            </span>
            <Vault className="size-4 text-brand-600" />
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-bold text-ink-900">{plans.length}</p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-500">
            {plans.filter((p) => p.isActive).length} {t('metrics.activePlans')}
          </p>
        </Card>

        <Card className="border-ink-200 bg-surface p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-[0.6875rem] sm:text-xs font-medium uppercase tracking-wider">
              {t('metrics.activeVaults')}
            </span>
            <Lock className="size-4 text-amber-500" />
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-bold text-ink-900">{activeInvestments.length}</p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-500">
            {investments.length} {t('metrics.totalDeposits')}
          </p>
        </Card>

        <Card className="border-ink-200 bg-surface p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-[0.6875rem] sm:text-xs font-medium uppercase tracking-wider">
              {t('metrics.capitalLocked')}
            </span>
            <Coins className="size-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-lg sm:text-2xl font-bold text-emerald-600">
            GHS {format.number(totalLockedMinor / 100, { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-500">{t('metrics.currentlyLocked')}</p>
        </Card>

        <Card className="border-ink-200 bg-surface p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-[0.6875rem] sm:text-xs font-medium uppercase tracking-wider">
              {t('metrics.claimedPayouts')}
            </span>
            <TrendingUp className="size-4 text-brand-500" />
          </div>
          <p className="mt-2 text-lg sm:text-2xl font-bold text-ink-900">
            {format.number(totalClaimedPoints)}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-500">{t('metrics.paidToUsers')}</p>
        </Card>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-2 border-b border-ink-200 pb-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('plans')
            setEditing(null)
          }}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors',
            activeTab === 'plans'
              ? 'bg-brand-600 text-white'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
          )}
        >
          {t('tabs.plans')} ({plans.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('investments')
            setEditing(null)
          }}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors',
            activeTab === 'investments'
              ? 'bg-brand-600 text-white'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
          )}
        >
          {t('tabs.investments')} ({investments.length})
        </button>
      </div>

      {/* Tab: Plans */}
      {activeTab === 'plans' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-ink-900">{t('plansTable.title')}</h2>
              <p className="text-xs text-ink-500">{t('plansTable.subtitle')}</p>
            </div>
            {!editing && (
              <Button size="sm" onClick={() => setEditing('new')} leadingIcon={<Plus className="size-3.5" />}>
                {t('plansTable.createBtn')}
              </Button>
            )}
          </div>

          {/* Form when editing or creating */}
          {editing && (
            <PlanForm
              plan={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                setFeedback({ type: 'success', message: t('planSavedMsg') })
                router.refresh()
              }}
              onError={(msg) => setFeedback({ type: 'error', message: msg })}
            />
          )}

          {/* Mobile Plans Card List */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {plans.length === 0 ? (
              <li className="rounded-(--radius-card) border border-dashed border-ink-200 p-6 text-center text-xs text-ink-500">
                {t('plansTable.noPlans')}
              </li>
            ) : (
              plans.map((plan) => {
                const priceGhs = plan.priceMinor / 100
                const dailyProfitGhs = priceGhs * (plan.dailyReturnPercent / 100)
                const totalProfitGhs = dailyProfitGhs * plan.periodDays
                const totalReturnGhs = priceGhs + totalProfitGhs

                return (
                  <li
                    key={plan.id}
                    className="flex flex-col gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-ink-900">{plan.name}</h3>
                        {plan.description && (
                          <p className="mt-0.5 text-xs text-ink-500">{plan.description}</p>
                        )}
                      </div>
                      <StatusDot tone={plan.isActive ? 'success' : 'neutral'}>
                        {plan.isActive ? t('active') : t('inactive')}
                      </StatusDot>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-md bg-ink-50/75 p-2.5 text-xs">
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('plansTable.price')}</span>
                        <p className="font-bold text-ink-900">
                          GHS {format.number(priceGhs, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('plansTable.duration')}</span>
                        <p className="font-medium text-ink-800">
                          {plan.periodDays} {t('days')}
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('plansTable.dailyReturn')}</span>
                        <p className="font-semibold text-emerald-600">
                          +{plan.dailyReturnPercent}%/day
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('plansTable.totalReturn')}</span>
                        <p className="font-bold text-brand-700">
                          GHS {format.number(totalReturnGhs, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-2.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(plan)}
                        leadingIcon={<Edit2 className="size-3.5" />}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeletePlan(plan.id)}
                        className="text-danger-600 hover:text-danger-700 hover:bg-danger-50"
                        leadingIcon={<Trash2 className="size-3.5" />}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  </li>
                )
              })
            )}
          </ul>

          {/* Desktop Plans Table */}
          <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface shadow-xs lg:block">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-100 bg-ink-50/75 text-ink-500 uppercase font-semibold">
                <tr>
                  <th className="p-3.5">{t('plansTable.name')}</th>
                  <th className="p-3.5">{t('plansTable.price')}</th>
                  <th className="p-3.5">{t('plansTable.duration')}</th>
                  <th className="p-3.5">{t('plansTable.dailyReturn')}</th>
                  <th className="p-3.5">{t('plansTable.totalReturn')}</th>
                  <th className="p-3.5">{t('plansTable.status')}</th>
                  <th className="p-3.5 text-right">{t('plansTable.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 text-ink-700">
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-ink-500">
                      {t('plansTable.noPlans')}
                    </td>
                  </tr>
                ) : (
                  plans.map((plan) => {
                    const priceGhs = plan.priceMinor / 100
                    const totalProfitGhs = priceGhs * (plan.dailyReturnPercent / 100) * plan.periodDays
                    const totalReturnGhs = priceGhs + totalProfitGhs

                    return (
                      <tr key={plan.id} className="hover:bg-ink-50/50">
                        <td className="p-3.5">
                          <p className="font-bold text-ink-900">{plan.name}</p>
                          {plan.description && (
                            <p className="text-[0.6875rem] text-ink-500">{plan.description}</p>
                          )}
                        </td>
                        <td className="p-3.5 font-semibold text-ink-900">
                          GHS {format.number(priceGhs, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3.5">
                          {plan.periodDays} {t('days')}
                        </td>
                        <td className="p-3.5">
                          <span className="font-semibold text-emerald-600">
                            +{plan.dailyReturnPercent}% / day
                          </span>
                        </td>
                        <td className="p-3.5">
                          <p className="font-bold text-brand-700">
                            GHS {format.number(totalReturnGhs, { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-[0.6875rem] text-emerald-600">
                            (+GHS {format.number(totalProfitGhs, { minimumFractionDigits: 2 })} {t('profit')})
                          </p>
                        </td>
                        <td className="p-3.5">
                          <StatusDot tone={plan.isActive ? 'success' : 'neutral'}>
                            {plan.isActive ? t('active') : t('inactive')}
                          </StatusDot>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(plan)}
                              aria-label="Edit Plan"
                            >
                              <Edit2 className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeletePlan(plan.id)}
                              className="text-danger-600 hover:text-danger-700"
                              aria-label="Delete Plan"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: User Investments */}
      {activeTab === 'investments' && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold text-ink-900">{t('investmentsTable.title')}</h2>
            <p className="text-xs text-ink-500">{t('investmentsTable.subtitle')}</p>
          </div>

          {/* Mobile Investments Card List */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {investments.length === 0 ? (
              <li className="rounded-(--radius-card) border border-dashed border-ink-200 p-6 text-center text-xs text-ink-500">
                {t('investmentsTable.noInvestments')}
              </li>
            ) : (
              investments.map((inv) => {
                const now = new Date()
                const endsAt = new Date(inv.endsAt)
                const isMatured = now >= endsAt
                const tone = inv.status === 'claimed' ? 'neutral' : isMatured ? 'warning' : 'success'

                return (
                  <li
                    key={inv.id}
                    className="flex flex-col gap-2.5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-ink-900">{inv.planName}</p>
                        <p className="text-xs text-ink-500">
                          {inv.userFullName ?? inv.userEmail ?? inv.userId.slice(0, 8)}
                        </p>
                      </div>
                      <StatusDot tone={tone}>
                        {inv.status === 'claimed'
                          ? t('status.claimed')
                          : isMatured
                            ? t('status.matured')
                            : t('status.active')}
                      </StatusDot>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-md bg-ink-50/75 p-2.5 text-xs">
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('investmentsTable.deposit')}</span>
                        <p className="font-bold text-ink-900">
                          GHS {format.number(inv.amountMinor / 100, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('investmentsTable.duration')}</span>
                        <p className="font-medium text-ink-800">
                          {inv.periodDays} {t('days')} ({inv.dailyReturnPercent}%/d)
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('investmentsTable.expectedReturn')}</span>
                        <p className="font-bold text-emerald-600">
                          GHS {format.number(inv.expectedReturnMinor / 100, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.6875rem] text-ink-500 uppercase">{t('investmentsTable.maturityDate')}</span>
                        <p className="font-medium text-ink-800">
                          {format.dateTime(endsAt, { dateStyle: 'short' })}
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })
            )}
          </ul>

          {/* Desktop Investments Table */}
          <div className="hidden overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface shadow-xs lg:block">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-ink-100 bg-ink-50/75 text-ink-500 uppercase font-semibold">
                <tr>
                  <th className="p-3.5">{t('investmentsTable.user')}</th>
                  <th className="p-3.5">{t('investmentsTable.plan')}</th>
                  <th className="p-3.5">{t('investmentsTable.deposit')}</th>
                  <th className="p-3.5">{t('investmentsTable.duration')}</th>
                  <th className="p-3.5">{t('investmentsTable.expectedReturn')}</th>
                  <th className="p-3.5">{t('investmentsTable.maturityDate')}</th>
                  <th className="p-3.5">{t('investmentsTable.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 text-ink-700">
                {investments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-ink-500">
                      {t('investmentsTable.noInvestments')}
                    </td>
                  </tr>
                ) : (
                  investments.map((inv) => {
                    const now = new Date()
                    const endsAt = new Date(inv.endsAt)
                    const isMatured = now >= endsAt
                    const tone = inv.status === 'claimed' ? 'neutral' : isMatured ? 'warning' : 'success'

                    return (
                      <tr key={inv.id} className="hover:bg-ink-50/50">
                        <td className="p-3.5 font-medium text-ink-900">
                          <div>
                            <p>{inv.userFullName ?? inv.userEmail ?? inv.userId.slice(0, 8)}</p>
                            {inv.userEmail && inv.userFullName && (
                              <p className="text-[0.6875rem] text-ink-400">{inv.userEmail}</p>
                            )}
                          </div>
                        </td>
                        <td className="p-3.5 font-bold text-ink-900">{inv.planName}</td>
                        <td className="p-3.5 font-semibold text-ink-900">
                          GHS {format.number(inv.amountMinor / 100, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3.5">
                          {inv.periodDays} {t('days')} ({inv.dailyReturnPercent}%/d)
                        </td>
                        <td className="p-3.5 font-bold text-emerald-600">
                          GHS {format.number(inv.expectedReturnMinor / 100, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3.5 text-ink-500">
                          {format.dateTime(endsAt, { dateStyle: 'medium' })}
                        </td>
                        <td className="p-3.5">
                          <StatusDot tone={tone}>
                            {inv.status === 'claimed'
                              ? t('status.claimed')
                              : isMatured
                                ? t('status.matured')
                                : t('status.active')}
                          </StatusDot>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanForm({
  plan,
  onClose,
  onSaved,
  onError,
}: {
  plan: VaultPlan | null
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const t = useTranslations('admin.vault')
  const format = useFormatter()
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(plan?.name ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [priceGhs, setPriceGhs] = useState(plan ? (plan.priceMinor / 100).toString() : '100')
  const [periodDays, setPeriodDays] = useState(plan ? plan.periodDays.toString() : '30')
  const [dailyReturnPercent, setDailyReturnPercent] = useState(
    plan ? plan.dailyReturnPercent.toString() : '1.5',
  )
  const [isActive, setIsActive] = useState(plan?.isActive ?? true)

  // Live calculations
  const calcPrice = parseFloat(priceGhs) || 0
  const calcDays = parseInt(periodDays, 10) || 0
  const calcPercent = parseFloat(dailyReturnPercent) || 0
  const calcDailyProfit = calcPrice * (calcPercent / 100)
  const calcTotalProfit = calcDailyProfit * calcDays
  const calcTotalMaturity = calcPrice + calcTotalProfit

  const ready = name.trim().length > 0 && calcPrice > 0 && calcDays > 0 && calcPercent > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return

    startTransition(async () => {
      const input: VaultPlanInput = {
        id: plan?.id,
        name: name.trim(),
        description: description.trim() || undefined,
        priceMinor: Math.round(calcPrice * 100),
        currencyCode: 'GHS',
        periodDays: calcDays,
        dailyReturnPercent: calcPercent,
        isActive,
      }

      const res = await saveVaultPlanAction(input)
      if (!res.ok) {
        onError(res.message ?? 'Failed to save vault plan')
        return
      }

      onSaved()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-(--radius-card) border border-brand-500/30 bg-surface p-4 sm:p-5 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-ink-100 pb-3">
        <h3 className="text-base font-bold text-ink-900">
          {plan ? t('form.editTitle') : t('form.createTitle')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded p-1 text-ink-400 hover:text-ink-900"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label={t('form.name')} className="sm:col-span-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 30-Day Growth Vault"
            className={inputClass()}
            required
          />
        </Field>

        <Field label={t('form.price')} suffix="GHS">
          <input
            type="number"
            step="0.01"
            min="1"
            value={priceGhs}
            onChange={(e) => setPriceGhs(e.target.value)}
            className={inputClass()}
            required
          />
        </Field>

        <Field label={t('form.duration')} suffix={t('days')}>
          <input
            type="number"
            step="1"
            min="1"
            value={periodDays}
            onChange={(e) => setPeriodDays(e.target.value)}
            className={inputClass()}
            required
          />
        </Field>

        <Field label={t('form.dailyReturn')} suffix="%" className="sm:col-span-2">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={dailyReturnPercent}
            onChange={(e) => setDailyReturnPercent(e.target.value)}
            className={inputClass()}
            required
          />
        </Field>

        <Field label={t('form.description')} hint={t('form.descriptionHint')} className="sm:col-span-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief explanation of this vault tier"
            rows={2}
            className={cn(inputClass(), 'h-auto py-2')}
          />
        </Field>
      </div>

      <div className="mt-1">
        <SwitchRow
          title={t('form.active')}
          description={t('form.activeHint')}
          checked={isActive}
          onChange={setIsActive}
        />
      </div>

      {/* Live Financial Preview */}
      {ready && (
        <div className="rounded-(--radius-card) border border-brand-500/20 bg-brand-50/50 p-3.5 text-xs text-ink-700">
          <p className="font-semibold text-brand-900 mb-1">{t('form.livePreview')}</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[0.6875rem] text-ink-500 block">{t('form.dailyEarning')}</span>
              <span className="font-bold text-ink-900">
                +GHS {format.number(calcDailyProfit, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-[0.6875rem] text-ink-500 block">{t('form.totalProfit')}</span>
              <span className="font-bold text-emerald-600">
                +GHS {format.number(calcTotalProfit, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-[0.6875rem] text-ink-500 block">{t('form.maturityPayout')}</span>
              <span className="font-bold text-brand-700">
                GHS {format.number(calcTotalMaturity, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-3">
        <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="md" disabled={!ready || pending} loading={pending}>
          {plan ? t('save') : t('form.submit')}
        </Button>
      </div>
    </form>
  )
}
