'use client'

import { useMemo, useState } from 'react'

import { AlertTriangle, Check, Wand2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import {
  alignedBenefits,
  checkPlanValue,
  nextDraftPlanId,
  slugify,
  undercutBy,
  validatePlan,
  type HouseRate,
} from '@/lib/admin/plan-value'
import type { PlanRow } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { DetailPanel, PanelFooter, PanelSection } from './DetailPanel'

/**
 * The plan editor — one plan, every column, and the rule that keeps the
 * ladder honest.
 *
 * THE VALUE CHECK IS THE POINT OF THIS SCREEN
 * Migration 037 aligned every plan to one value per cedi, and closed with an
 * instruction: "If the admin dashboard later sets a plan's benefits out of
 * proportion to its price, the ordering can break again. That rule belongs on
 * the admin plan editor when it is built." So the editor does three things
 * about it, in increasing order of insistence:
 *
 *   1. Fills the benefits in from the price on a new plan, so the default
 *      path is the correct one and nobody has to know the arithmetic.
 *   2. Shows what the price should buy, live, whenever the numbers drift.
 *   3. Names the actual harm when it can find it — "Bronze + Silver costs
 *      GHS 70 and would give more than this" — because a slope means nothing
 *      to somebody pricing a plan and a cheaper combination beating a dearer
 *      one means everything.
 *
 * It never blocks. A promotional plan priced off the line is a legitimate
 * thing to want, and an operator who reads the warning is entitled to
 * overrule it. Warnings that cannot be overruled get worked around.
 *
 * WHAT IS NOT EDITABLE, AND WHY
 * The slug is fixed once a plan exists: subscriptions, payments and the seed
 * all refer to a plan by slug, so changing it silently orphans them. The
 * default flag is not offered at all — the database allows exactly one
 * default, it must be free, and it must be active, so moving it is a
 * migration rather than a form field.
 */

type Draft = Omit<PlanRow, 'active' | 'activeLastMonth' | 'monthlyGhs'>

const blank = (rate: HouseRate): Draft => ({
  id: nextDraftPlanId(),
  slug: '',
  name: '',
  description: '',
  priceGhs: 0,
  billingPeriodDays: 90,
  dailyAdCap: rate.freeAdCap,
  rewardMultiplier: 1,
  redemptionMinimumPoints: 5000,
  referralBonusMultiplier: 1,
  adPriority: 0,
  adCooldownSeconds: 0,
  isDefault: false,
  status: 'hidden',
  sortOrder: 0,
})

export function PlanPanel({
  plan,
  plans,
  rate,
  onClose,
  onSave,
}: {
  /** null when creating. */
  plan: PlanRow | null
  plans: PlanRow[]
  rate: HouseRate
  onClose: () => void
  onSave: (plan: PlanRow) => void
}) {
  const t = useTranslations('admin.subscriptions')
  const isNew = plan === null

  const [draft, setDraft] = useState<Draft>(() => (plan ? { ...plan } : blank(rate)))
  /** Only set once the operator has typed a slug themselves, so the suggestion
   *  stops following the name the moment they take control of it. */
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [showErrors, setShowErrors] = useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /* Naming a new plan suggests its slug. Existing plans keep theirs. */
  const setName = (name: string) =>
    setDraft((d) => ({ ...d, name, slug: slugTouched ? d.slug : slugify(name) }))

  /* Pricing a NEW plan fills the benefits in from the line, so the correct
     answer is the one you get by doing nothing. An existing plan is left
     alone — silently rewriting a live plan's benefits because somebody
     adjusted its price is not a favour. */
  const setPrice = (priceGhs: number) =>
    setDraft((d) => {
      if (!isNew) return { ...d, priceGhs }
      const aligned = alignedBenefits(priceGhs, rate)
      return { ...d, priceGhs, ...aligned, referralBonusMultiplier: aligned.rewardMultiplier }
    })

  const otherSlugs = plans.filter((p) => p.id !== draft.id).map((p) => p.slug)
  const errors = useMemo(() => validatePlan(draft, otherSlugs), [draft, otherSlugs])
  const check = useMemo(() => checkPlanValue(draft, rate), [draft, rate])
  const undercut = useMemo(
    () => (check.aligned ? null : undercutBy(draft, plans, rate)),
    [check.aligned, draft, plans, rate],
  )

  const alignToPrice = () => {
    const aligned = alignedBenefits(draft.priceGhs, rate)
    setDraft((d) => ({ ...d, ...aligned, referralBonusMultiplier: aligned.rewardMultiplier }))
  }

  const submit = () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true)
      return
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      active: plan?.active ?? 0,
      activeLastMonth: plan?.activeLastMonth ?? 0,
      monthlyGhs: plan?.monthlyGhs ?? 0,
    })
  }

  const err = (field: string) => (showErrors ? errors[field] : undefined)

  /* The value-per-cedi verdict. An element rather than a component: declaring
     a component inside render remounts it — and its state — on every
     keystroke, which is exactly the field this thing reacts to. */
  const valueCheck = draft.priceGhs > 0 ? (

            <div
              className={cn(
                'mt-3 rounded-(--radius-card) border p-3.5',
                check.aligned
                  ? 'border-success-500/25 bg-success-50'
                  : 'border-warning-500/30 bg-warning-50',
              )}
            >
              <p
                className={cn(
                  'flex items-center gap-1.5 text-[0.8125rem] font-semibold',
                  check.aligned ? 'text-success-700' : 'text-warning-600',
                )}
              >
                {check.aligned ? (
                  <Check aria-hidden className="size-4 shrink-0" />
                ) : (
                  <AlertTriangle aria-hidden className="size-4 shrink-0" />
                )}
                {check.aligned ? t('valueWarn.okTitle') : t('valueWarn.title')}
              </p>

              <p
                className={cn(
                  'mt-1.5 text-[0.75rem] leading-relaxed',
                  check.aligned ? 'text-success-700/90' : 'text-warning-600/90',
                )}
              >
                {check.aligned
                  ? t('valueWarn.okBody', {
                      ads: rate.adsPerCedi,
                      pct: Math.round(rate.ratePerCedi * 1000) / 10,
                    })
                  : t('valueWarn.body', {
                      price: draft.priceGhs,
                      ads: check.expected.dailyAdCap,
                      multiplier: check.expected.rewardMultiplier,
                    })}
              </p>

              {/* The concrete harm, when there is one to name. */}
              {undercut && (
                <p className="mt-2 rounded-(--radius-input) bg-warning-500/10 px-2.5 py-2 text-[0.75rem] leading-relaxed font-medium text-warning-600">
                  {t('valueWarn.undercut', {
                    plans: undercut.names.join(' + '),
                    price: undercut.priceGhs,
                    ads: undercut.dailyAdCap,
                    multiplier: undercut.rewardMultiplier,
                  })}
                </p>
              )}

              {!check.aligned && (
                <button
                  type="button"
                  onClick={alignToPrice}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-(--radius-input) border border-warning-500/40 bg-surface px-2.5 py-1.5 text-[0.75rem] font-semibold text-warning-600 transition-colors hover:bg-warning-50"
                >
                  <Wand2 aria-hidden className="size-3.5" />
                  {t('valueWarn.fix')}
                </button>
              )}
            </div>
  ) : null


  return (
    <DetailPanel
      title={isNew ? t('panel.newTitle') : t('panel.title', { name: plan.name })}
      closeLabel={t('panel.close')}
      onClose={onClose}
      width="lg"
      header={
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-semibold text-ink-900">
            {isNew ? t('panel.newTitle') : plan.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <StatusDot tone={draft.status === 'live' ? 'success' : 'neutral'}>
              {t(`status.${draft.status}`)}
            </StatusDot>
            {!isNew && plan.active > 0 && (
              <span className="text-[0.75rem] text-ink-400">
                {t('panel.subscribers', { count: plan.active })}
              </span>
            )}
          </div>
        </div>
      }
      footer={
        <PanelFooter>
          <div className="flex gap-2">
            <Button type="button" size="md" variant="secondary" onClick={onClose} className="flex-1">
              {t('panel.cancel')}
            </Button>
            <Button type="button" size="md" onClick={submit} className="flex-1">
              <Check aria-hidden className="size-4" />
              {isNew ? t('panel.create') : t('panel.save')}
            </Button>
          </div>
          {showErrors && Object.keys(errors).length > 0 && (
            <p role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
              {t('panel.fixErrors', { count: Object.keys(errors).length })}
            </p>
          )}
        </PanelFooter>
      }
    >
      {/* ---- Identity --------------------------------------------------- */}
      <PanelSection label={t('panel.identity')}>
        <div className="flex flex-col gap-3">
          <Field label={t('fields.name')} error={err('name') && t(`errors.${err('name')}`)}>
            <input
              value={draft.name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder={t('fields.namePlaceholder')}
              className={inputClass(Boolean(err('name')))}
            />
          </Field>

          <Field
            label={t('fields.slug')}
            hint={isNew ? t('fields.slugHint') : t('fields.slugLocked')}
            error={err('slug') && t(`errors.${err('slug')}`)}
          >
            <input
              value={draft.slug}
              onChange={(e) => {
                setSlugTouched(true)
                set('slug', e.target.value)
              }}
              disabled={!isNew}
              placeholder="bronze"
              className={cn(inputClass(Boolean(err('slug'))), 'font-mono disabled:opacity-60')}
            />
          </Field>

          <Field label={t('fields.description')} hint={t('fields.descriptionHint')}>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('fields.descriptionPlaceholder')}
              className={cn(inputClass(false), 'h-auto resize-none py-2')}
            />
          </Field>
        </div>
      </PanelSection>

      {/* ---- Price ------------------------------------------------------ */}
      <PanelSection label={t('panel.price')}>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('fields.price')}
            suffix="GHS"
            error={err('priceGhs') && t(`errors.${err('priceGhs')}`)}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.priceGhs}
              onChange={(e) => setPrice(Number(e.target.value))}
              className={inputClass(Boolean(err('priceGhs')))}
            />
          </Field>
          <Field
            label={t('fields.period')}
            suffix={t('units.days')}
            error={err('billingPeriodDays') && t(`errors.${err('billingPeriodDays')}`)}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              value={draft.billingPeriodDays}
              onChange={(e) => set('billingPeriodDays', Number(e.target.value))}
              className={inputClass(Boolean(err('billingPeriodDays')))}
            />
          </Field>
        </div>
      </PanelSection>

      {/* ---- Benefits --------------------------------------------------- */}
      <PanelSection label={t('panel.benefits')}>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('fields.dailyAdCap')}
            hint={t('fields.dailyAdCapHint', { free: rate.freeAdCap })}
            suffix={t('units.perDay')}
            error={err('dailyAdCap') && t(`errors.${err('dailyAdCap')}`)}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.dailyAdCap}
              onChange={(e) => set('dailyAdCap', Number(e.target.value))}
              className={inputClass(Boolean(err('dailyAdCap')))}
            />
          </Field>
          <Field
            label={t('fields.rewardMultiplier')}
            hint={t('fields.rewardMultiplierHint')}
            suffix="×"
            error={err('rewardMultiplier') && t(`errors.${err('rewardMultiplier')}`)}
          >
            <input
              type="number"
              inputMode="decimal"
              min={0.001}
              max={100}
              step={0.05}
              value={draft.rewardMultiplier}
              onChange={(e) => set('rewardMultiplier', Number(e.target.value))}
              className={inputClass(Boolean(err('rewardMultiplier')))}
            />
          </Field>
        </div>

        {/* ---- The rule -------------------------------------------------
            Directly under the two fields it governs, not at the end of the
            section. On a laptop the rest of the perks push it below the fold,
            so an operator typing into "Ads a day" — the field that breaks the
            line most often — could not see what their number had just done. */}
        {valueCheck}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field
            label={t('fields.redemptionMinimum')}
            hint={t('fields.redemptionMinimumHint')}
            suffix={t('units.points')}
            error={err('redemptionMinimumPoints') && t(`errors.${err('redemptionMinimumPoints')}`)}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={500}
              value={draft.redemptionMinimumPoints}
              onChange={(e) => set('redemptionMinimumPoints', Number(e.target.value))}
              className={inputClass(Boolean(err('redemptionMinimumPoints')))}
            />
          </Field>
          <Field
            label={t('fields.referralMultiplier')}
            hint={t('fields.referralMultiplierHint')}
            suffix="×"
            error={err('referralBonusMultiplier') && t(`errors.${err('referralBonusMultiplier')}`)}
          >
            <input
              type="number"
              inputMode="decimal"
              min={0.001}
              max={100}
              step={0.05}
              value={draft.referralBonusMultiplier}
              onChange={(e) => set('referralBonusMultiplier', Number(e.target.value))}
              className={inputClass(Boolean(err('referralBonusMultiplier')))}
            />
          </Field>
          <Field
            label={t('fields.adPriority')}
            hint={t('fields.adPriorityHint')}
            error={err('adPriority') && t(`errors.${err('adPriority')}`)}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.adPriority}
              onChange={(e) => set('adPriority', Number(e.target.value))}
              className={inputClass(Boolean(err('adPriority')))}
            />
          </Field>
          <Field
            label={t('fields.cooldown')}
            hint={t('fields.cooldownHint')}
            suffix={t('units.seconds')}
            error={err('adCooldownSeconds') && t(`errors.${err('adCooldownSeconds')}`)}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.adCooldownSeconds}
              onChange={(e) => set('adCooldownSeconds', Number(e.target.value))}
              className={inputClass(Boolean(err('adCooldownSeconds')))}
            />
          </Field>
        </div>

      </PanelSection>

      {/* ---- Availability ----------------------------------------------- */}
      <PanelSection label={t('panel.availability')}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-ink-200 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-medium text-ink-900">{t('fields.onSale')}</p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-ink-500">
                {draft.isDefault
                  ? t('fields.onSaleDefault')
                  : !isNew && plan.active > 0 && draft.status === 'hidden'
                    ? t('fields.onSaleKeeps', { count: plan.active })
                    : t('fields.onSaleHint')}
              </p>
            </div>
            <Switch
              checked={draft.status === 'live'}
              /* The database refuses to deactivate the default tier — every
                 new user lands on it and expiry downgrades back to it. */
              disabled={draft.isDefault}
              onChange={(v) => set('status', v ? 'live' : 'hidden')}
              label={t('fields.onSale')}
            />
          </div>

          <Field label={t('fields.sortOrder')} hint={t('fields.sortOrderHint')}>
            <input
              type="number"
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(e) => set('sortOrder', Number(e.target.value))}
              className={inputClass(false)}
            />
          </Field>
        </div>
      </PanelSection>
    </DetailPanel>
  )
}

/* ------------------------------------------------------------------ */

function inputClass(invalid: boolean) {
  return cn(
    'h-10 w-full rounded-(--radius-input) border bg-canvas px-3 text-[0.8125rem] text-ink-900',
    'placeholder:text-ink-400 focus:outline-none pointer-coarse:h-11 pointer-coarse:text-base',
    invalid ? 'border-danger-500 focus:border-danger-600' : 'border-ink-200 focus:border-brand-600',
  )
}

function Field({
  label,
  hint,
  suffix,
  error,
  children,
}: {
  label: string
  hint?: string
  suffix?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[0.75rem] font-medium text-ink-700">{label}</span>
        {suffix && <span className="text-[0.6875rem] text-ink-400">{suffix}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? (
        <span role="alert" className="mt-1 block text-[0.6875rem] font-medium text-danger-600">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[0.625rem] leading-snug text-ink-400">{hint}</span>
      )}
    </label>
  )
}

/** Same switch as the settings form — a real checkbox with the track drawn
 *  on top, so space toggles it and assistive technology reads it correctly. */
function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'peer h-6 w-11 cursor-pointer appearance-none rounded-full border transition-colors',
          'border-ink-300 bg-ink-200 checked:border-brand-600 checked:bg-brand-600',
          'focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-0.5 size-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"
      />
    </span>
  )
}
