'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { saveCampaign, deleteCampaign, type CampaignInput } from '@/app/[locale]/admin/(super)/weekly-bonus/actions'
import { Button } from '@/components/ui/Button'
import type { AdminWeeklyBonusCampaign } from '@/lib/admin/data/weekly-bonus'
import { cn } from '@/lib/cn'

const blank = (): CampaignInput => ({
  id: null,
  name: '',
  description: '',
  min_referrals: 10,
  max_referrals: 20,
  reward_minor: 5000,
  sort_order: 0,
  is_active: true,
})

const toInput = (campaign: AdminWeeklyBonusCampaign): CampaignInput => ({
  id: campaign.id,
  name: campaign.name,
  description: campaign.description || '',
  min_referrals: campaign.minReferrals,
  max_referrals: campaign.maxReferrals,
  reward_minor: campaign.rewardMinor,
  sort_order: campaign.sortOrder,
  is_active: campaign.isActive,
})

export function WeeklyBonusCampaigns({ campaigns }: { campaigns: AdminWeeklyBonusCampaign[] }) {
  const t = useTranslations('admin.weeklyBonus')
  const format = useFormatter()

  const [draft, setDraft] = useState<CampaignInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const patch = (next: Partial<CampaignInput>) => {
    setSaved(false)
    setDraft((d) => (d ? { ...d, ...next } : d))
  }

  const save = () => {
    if (!draft) return
    setError(null)

    if (draft.name.trim().length === 0) {
      setError(t('errors.required'))
      return
    }
    
    if (draft.min_referrals < 1) {
      setError(t('errors.minRange'))
      return
    }

    startTransition(async () => {
      const result = await saveCampaign(draft)
      if (!result.ok) setError(result.message)
      else {
        setSaved(true)
        setDraft(null)
      }
    })
  }

  const remove = (campaign: AdminWeeklyBonusCampaign) => {
    setError(null)
    startTransition(async () => {
      const result = await deleteCampaign(campaign.id)
      if (!result.ok) setError(result.message)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-500">{t('intro')}</p>
        <Button onClick={() => { setDraft(blank()); setError(null); setSaved(false) }}>
          <Plus aria-hidden className="size-4" />
          {t('new')}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-600">
          <Check aria-hidden className="size-4" />
          {t('saved')}
        </p>
      )}

      {/* ---- Editor ------------------------------------------------------ */}
      {draft && (
        <section className="rounded-(--radius-panel) border border-brand-500/30 bg-surface p-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">
            {draft.id ? t('editing') : t('creating')}
          </h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Text label={t('field.name')} value={draft.name} onChange={(v) => patch({ name: v })} />
            <Num
              label={t('field.sortOrder')}
              value={draft.sort_order}
              onChange={(v) => patch({ sort_order: v })}
            />
          </div>

          <label className="mt-3 block">
            <span className="text-[0.8125rem] font-medium text-ink-700">{t('field.description')}</span>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              maxLength={300}
              className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.875rem] text-ink-900"
            />
            <span className="text-[0.75rem] text-ink-400">{t('field.descriptionHint')}</span>
          </label>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Num label={t('field.minReferrals')} value={draft.min_referrals} onChange={(v) => patch({ min_referrals: v })} />
            
            <div className="space-y-1">
              <label className="block">
                <span className="text-[0.8125rem] font-medium text-ink-700">{t('field.maxReferrals')}</span>
                <input
                  type="number"
                  min={draft.min_referrals}
                  disabled={draft.max_referrals === null}
                  value={draft.max_referrals === null ? '' : draft.max_referrals}
                  onChange={(e) => patch({ max_referrals: e.target.value === '' ? null : Math.max(draft.min_referrals, Number(e.target.value)) })}
                  className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-right text-[0.875rem] tabular-nums text-ink-900 disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.max_referrals === null}
                  onChange={(e) => patch({ max_referrals: e.target.checked ? null : draft.min_referrals + 10 })}
                  className="rounded border-ink-300 text-brand-600 focus:ring-brand-600"
                />
                <span className="text-[0.8125rem] text-ink-700">{t('field.uncapped')}</span>
              </label>
            </div>

            <label className="block">
              <span className="text-[0.8125rem] font-medium text-ink-700">{t('field.rewardGhs')}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={draft.reward_minor / 100}
                onChange={(e) => patch({ reward_minor: Math.round(Number(e.target.value) * 100) })}
                className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-right text-[0.875rem] tabular-nums text-ink-900"
              />
              <span className="text-[0.75rem] text-ink-400">{t('field.rewardHint')}</span>
            </label>
          </div>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => patch({ is_active: e.target.checked })}
              className="rounded border-ink-300 text-brand-600 focus:ring-brand-600"
            />
            <span className="text-[0.875rem] font-medium text-ink-900">{t('field.active')}</span>
          </label>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={save} loading={pending}>{t('save')}</Button>
            <button
              type="button"
              onClick={() => { setDraft(null); setError(null) }}
              className="text-[0.8125rem] font-medium text-ink-500 hover:text-ink-700"
            >
              {t('cancel')}
            </button>
          </div>
        </section>
      )}

      {/* ---- The list ----------------------------------------------------- */}
      <ol className="space-y-2">
        {campaigns.map((campaign) => (
          <li
            key={campaign.id}
            className={cn(
              'rounded-(--radius-panel) border bg-surface p-3.5',
              campaign.isActive ? 'border-ink-200' : 'border-dashed border-ink-200 opacity-60',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink-900">
                  {campaign.name}
                  {!campaign.isActive && (
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-500">
                      {t('archived')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-ink-500">{campaign.description}</p>
                <p className="mt-1.5 font-mono text-[0.6875rem] text-ink-600">
                  {campaign.maxReferrals === null
                    ? t('rangeOpen', { min: campaign.minReferrals })
                    : t('range', { min: campaign.minReferrals, max: campaign.maxReferrals })}
                  {' · '}
                  {t('reward', { amount: format.number(campaign.rewardGhs, { minimumFractionDigits: 2 }) })}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4 text-right">
                <div>
                  <p className="text-[0.875rem] font-bold tabular-nums text-success-700">
                    {t('stats.paid', { amount: format.number(campaign.totalPaidGhs, { minimumFractionDigits: 2 }) })}
                  </p>
                  <p className="text-[0.6875rem] tabular-nums text-ink-400">
                    {t('stats.enrolled', { count: campaign.enrolledCount })}
                  </p>
                  <p className="text-[0.6875rem] tabular-nums text-ink-400">
                    {t('stats.claims', { count: campaign.claimsCount })}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setDraft(toInput(campaign)); setError(null); setSaved(false) }}
                  >
                    {t('edit')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => remove(campaign)}
                    aria-label={t('remove')}
                    className="grid size-8 place-items-center rounded-(--radius-input) border border-ink-200 text-ink-400 transition-colors hover:border-danger-500/30 hover:text-danger-600"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Text({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[0.8125rem] font-medium text-ink-700">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.875rem] text-ink-900 disabled:opacity-60"
      />
      {hint && <span className="text-[0.75rem] text-ink-400">{hint}</span>}
    </label>
  )
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="text-[0.8125rem] font-medium text-ink-700">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-right text-[0.875rem] tabular-nums text-ink-900"
      />
    </label>
  )
}
