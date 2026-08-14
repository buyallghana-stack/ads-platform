'use client'

import { useState, useTransition } from 'react'

import {
  AlertCircle,
  Check,
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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<VaultPlan | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Form State
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPriceGhs, setFormPriceGhs] = useState('100')
  const [formPeriodDays, setFormPeriodDays] = useState('30')
  const [formDailyReturnPercent, setFormDailyReturnPercent] = useState('1.5')
  const [formIsActive, setFormIsActive] = useState(true)

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

  const openCreateModal = () => {
    setEditingPlan(null)
    setFormName('')
    setFormDescription('')
    setFormPriceGhs('100')
    setFormPeriodDays('30')
    setFormDailyReturnPercent('1.5')
    setFormIsActive(true)
    setIsModalOpen(true)
  }

  const openEditModal = (plan: VaultPlan) => {
    setEditingPlan(plan)
    setFormName(plan.name)
    setFormDescription(plan.description ?? '')
    setFormPriceGhs((plan.priceMinor / 100).toString())
    setFormPeriodDays(plan.periodDays.toString())
    setFormDailyReturnPercent(plan.dailyReturnPercent.toString())
    setFormIsActive(plan.isActive)
    setIsModalOpen(true)
  }

  const handleSavePlan = (e: React.FormEvent) => {
    e.preventDefault()
    setFeedback(null)

    const priceMinor = Math.round(parseFloat(formPriceGhs) * 100)
    const periodDays = parseInt(formPeriodDays, 10)
    const dailyReturnPercent = parseFloat(formDailyReturnPercent)

    if (isNaN(priceMinor) || priceMinor <= 0) {
      setFeedback({ type: 'error', message: 'Please enter a valid price in GHS' })
      return
    }
    if (isNaN(periodDays) || periodDays <= 0) {
      setFeedback({ type: 'error', message: 'Please enter valid period in days' })
      return
    }
    if (isNaN(dailyReturnPercent) || dailyReturnPercent <= 0) {
      setFeedback({ type: 'error', message: 'Please enter a valid daily return percentage' })
      return
    }

    startTransition(async () => {
      const input: VaultPlanInput = {
        id: editingPlan?.id,
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        priceMinor,
        periodDays,
        dailyReturnPercent,
        isActive: formIsActive,
      }

      const res = await saveVaultPlanAction(input)
      if (!res.ok) {
        setFeedback({ type: 'error', message: res.message ?? 'Failed to save vault plan' })
        return
      }

      setIsModalOpen(false)
      setFeedback({ type: 'success', message: t('planSavedMsg') })
      router.refresh()
    })
  }

  const handleDeletePlan = (planId: string) => {
    if (!confirm('Are you sure you want to delete or deactivate this plan?')) return
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
            <span
              className={cn(
                'size-2.5 rounded-full',
                vaultEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-ink-300',
              )}
            />
            <span className="text-xs font-semibold text-ink-800">
              {vaultEnabled ? t('globalActive') : t('globalPaused')}
            </span>
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
          className={cn(
            'flex items-center gap-2 rounded-(--radius-card) border p-3.5 text-xs font-medium',
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-50 text-emerald-800'
              : 'border-danger-500/30 bg-danger-50 text-danger-800',
          )}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="border-ink-200 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-xs font-medium uppercase tracking-wider">{t('metrics.totalPlans')}</span>
            <Vault className="size-4 text-brand-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-900">{plans.length}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {plans.filter((p) => p.isActive).length} {t('metrics.activePlans')}
          </p>
        </Card>

        <Card className="border-ink-200 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-xs font-medium uppercase tracking-wider">{t('metrics.activeVaults')}</span>
            <Lock className="size-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-900">{activeInvestments.length}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {investments.length} {t('metrics.totalDeposits')}
          </p>
        </Card>

        <Card className="border-ink-200 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-xs font-medium uppercase tracking-wider">{t('metrics.capitalLocked')}</span>
            <Coins className="size-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600">
            GHS {format.number(totalLockedMinor / 100, { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{t('metrics.currentlyLocked')}</p>
        </Card>

        <Card className="border-ink-200 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between text-ink-500">
            <span className="text-xs font-medium uppercase tracking-wider">{t('metrics.claimedPayouts')}</span>
            <TrendingUp className="size-4 text-brand-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-900">
            {format.number(totalClaimedPoints)} {t('points')}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{t('metrics.paidToUsers')}</p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-ink-200 pb-2">
        <button
          onClick={() => setActiveTab('plans')}
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
          onClick={() => setActiveTab('investments')}
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
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-ink-900">{t('plansTable.title')}</h2>
            <Button size="sm" onClick={openCreateModal} leadingIcon={<Plus className="size-3.5" />}>
              {t('plansTable.createBtn')}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-(--radius-card) border border-ink-200 bg-surface shadow-xs">
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
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold',
                              plan.isActive
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-ink-100 text-ink-600',
                            )}
                          >
                            {plan.isActive ? t('active') : t('inactive')}
                          </span>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditModal(plan)}
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
          <h2 className="text-base font-bold text-ink-900">{t('investmentsTable.title')}</h2>

          <div className="overflow-x-auto rounded-(--radius-card) border border-ink-200 bg-surface shadow-xs">
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
                  investments.map((inv) => (
                    <tr key={inv.id} className="hover:bg-ink-50/50">
                      <td className="p-3.5 font-medium text-ink-900">
                        {inv.userFullName ?? inv.userId.slice(0, 8)}
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
                        {format.dateTime(new Date(inv.endsAt), { dateStyle: 'medium' })}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold',
                            inv.status === 'claimed'
                              ? 'bg-ink-100 text-ink-700'
                              : new Date() >= new Date(inv.endsAt)
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800',
                          )}
                        >
                          {inv.status === 'claimed'
                            ? t('status.claimed')
                            : new Date() >= new Date(inv.endsAt)
                              ? t('status.matured')
                              : t('status.active')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Plan Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="animate-rise w-full max-w-md rounded-(--radius-panel) border border-ink-200 bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ink-100 pb-3">
              <h3 className="text-base font-bold text-ink-900">
                {editingPlan ? t('modal.editTitle') : t('modal.createTitle')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink-700">{t('modal.planName')}</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. 30-Day Growth Vault"
                  className="mt-1 w-full rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-2 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-700">{t('modal.description')}</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="e.g. Lock for 30 days and earn 1.8% daily"
                  className="mt-1 w-full rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-2 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-700">{t('modal.priceGhs')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={formPriceGhs}
                    onChange={(e) => setFormPriceGhs(e.target.value)}
                    className="mt-1 w-full rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-2 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-ink-700">{t('modal.periodDays')}</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formPeriodDays}
                    onChange={(e) => setFormPeriodDays(e.target.value)}
                    className="mt-1 w-full rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-2 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-700">{t('modal.dailyReturnPercent')}</label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={formDailyReturnPercent}
                    onChange={(e) => setFormDailyReturnPercent(e.target.value)}
                    className="w-full rounded-(--radius-input) border border-ink-300 bg-surface px-3 py-2 text-xs text-ink-900 focus:border-brand-500 focus:outline-none pr-8"
                  />
                  <span className="absolute right-3 top-2 text-xs text-ink-400">%</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="isActive" className="text-xs font-semibold text-ink-700 cursor-pointer">
                  {t('modal.isActiveLabel')}
                </label>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-ink-100 pt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsModalOpen(false)}
                >
                  {t('modal.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? t('modal.saving') : t('modal.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
