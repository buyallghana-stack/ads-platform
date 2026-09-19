'use client'

import { useMemo, useState } from 'react'

import { AlertTriangle, Check, Wand2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import {
  bandFor,
  benefitsBetween,
  checkBand,
  earningPerCedi,
  ladder,
  nextDraftPlanId,
  slugify,
  undercutBy,
  validatePlan,
} from '@/lib/admin/plan-value'
import type { PlanRow } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { StatusDot } from './AdminChrome'
import { DetailPanel, PanelFooter, PanelSection } from './DetailPanel'

/**
 * The plan editor — one plan, every column, and the rule that keeps the
 * ladder honest.
 *
 * THE PRICE FIELD IS NOT A PRICE, AND THAT IS THE POINT OF THIS SCREEN
 * Since migration 098 a plan is a BAND. The number typed into "Price" is the
 * FLOOR — the least somebody may pay — and the ceiling comes from the next
 * plan up. Two consequences an operator cannot be expected to guess, so the
 * editor states both, live, under the field:
 *
 *   1. This plan's real range. "Bronze: GHS 65 – 139, and what a buyer pays
 *      inside it moves their earning rate between ×1.5 and ×2.0."
 *   2. What it does to the plan BELOW. Repricing Silver from GHS 140 to
 *      GHS 200 silently widens Bronze's band to GHS 65 – 199 and changes what
 *      every future Bronze buyer earns. Nothing else on the screen would say
 *      so.
 *
 * It also warns about the three ways a rung goes wrong — a band nobody can
 * buy in, and an earning rate or ad count that FALLS as the price rises, which
 * makes the buyer's slider run backwards — and names the concrete harm when a
 * cheaper pair beats this plan, because plans stack.
 *
 * It never blocks. A promotional plan is a legitimate thing to want, and an
 * operator who reads the warning is entitled to overrule it. Warnings that
 * cannot be overruled get worked around.
 *
 * WHAT IS NOT EDITABLE, AND WHY
 * The slug is fixed once a plan exists: subscriptions, payments and the seed
 * all refer to a plan by slug, so changing it silently orphans them. The
 * default flag is not offered at all — the database allows exactly one
 * default, it must be free, and it must be active, so moving it is a
 * migration rather than a form field.
 */

/* Everything a plan IS, without anything about how it has sold. The DERIVED
   band ceiling is left out too: it is worked out from the plan above, so a
   draft carrying one would be a second source of truth. `ownBandMaxGhs` is a
   different thing and stays — it is a real column, and on the top rung it is
   the only place a ceiling can come from. */
type Draft = Omit<
  PlanRow,
  'active' | 'activeLastMonth' | 'monthlyGhs' | 'paidCount' | 'paidAboveFloor' | 'paidAvgGhs' | 'bandMaxGhs'
>

const blank = (free: number): Draft => ({
  id: nextDraftPlanId(),
  slug: '',
  name: '',
  description: '',
  priceGhs: 0,
  billingPeriodDays: 90,
  dailyAdCap: free,
  rewardMultiplier: 1,
  redemptionMinimumPoints: 5000,
  /* Sent because the RPC still takes it, never shown and never changed.
     Migration 081 made referral rewards flat, so nothing on the money path
     reads tiers.referral_bonus_multiplier any more — an editable field for it
     let an operator set "Referral bonus ×2" on a plan and watch it do
     absolutely nothing. A new plan gets 1, which is the multiplier that is
     actually applied; an existing plan keeps whatever it has. */
  referralBonusMultiplier: 1,
  adPriority: 0,
  adCooldownSeconds: 0,
  isDefault: false,
  status: 'hidden',
  sortOrder: 0,
  /* A new plan is created at the bottom of the ladder, never the top, so it
     has a plan above it to end its band against and no ceiling of its own. */
  ownBandMaxGhs: null,
  ownBandMaxMultiplier: null,
})

export function PlanPanel({
  plan,
  plans,
  free,
  onClose,
  onSave,
}: {
  /** null when creating. */
  plan: PlanRow | null
  plans: PlanRow[]
  /** Ads a day the free plan gives, which every stacking sum counts once. */
  free: number
  onClose: () => void
  onSave: (plan: PlanRow) => void
}) {
  const t = useTranslations('admin.subscriptions')
  const isNew = plan === null

  const [draft, setDraft] = useState<Draft>(() => (plan ? { ...plan } : blank(free)))
  /** Only set once the operator has typed a slug themselves, so the suggestion
   *  stops following the name the moment they take control of it. */
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [showErrors, setShowErrors] = useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /* Naming a new plan suggests its slug. Existing plans keep theirs. */
  const setName = (name: string) =>
    setDraft((d) => ({ ...d, name, slug: slugTouched ? d.slug : slugify(name) }))

  /* Pricing a NEW plan fills the benefits in from the line between the two
     plans it lands between, so the correct answer is the one you get by doing
     nothing — and under bands that is not merely tidy: a rung on the line
     leaves the interpolated earning rate continuous across the boundary, so
     nobody paying one cedi more sees their rate jump. An existing plan is left
     alone; silently rewriting a live plan's benefits because somebody adjusted
     its price is not a favour. */
  const setPrice = (priceGhs: number) =>
    setDraft((d) => {
      if (!isNew) return { ...d, priceGhs }
      return { ...d, priceGhs, ...benefitsBetween(priceGhs, plans) }
    })

  const otherSlugs = plans.filter((p) => p.id !== draft.id).map((p) => p.slug)
  const errors = useMemo(() => validatePlan(draft, otherSlugs), [draft, otherSlugs])

  /* The draft is checked BESIDE the other plans, with its own saved row taken
     out — otherwise an edit is measured against the version being replaced. */
  const others = useMemo(() => plans.filter((p) => p.id !== draft.id), [plans, draft.id])
  const check = useMemo(() => checkBand(draft, [...others, draft]), [others, draft])
  const band = check.band
  const undercut = useMemo(
    () => (draft.priceGhs > 0 ? undercutBy(draft, others, free) : null),
    [draft, others, free],
  )

  /* The plan directly BELOW this one, whose ceiling this plan's price sets.
     The single most surprising thing about the band model: repricing a plan
     changes what buyers of a DIFFERENT plan earn, and nothing else on the
     screen would mention it. */
  const below = useMemo(() => {
    const rungs = ladder(others)
    return [...rungs].reverse().find((p) => p.sortOrder < draft.sortOrder) ?? null
  }, [others, draft.sortOrder])

  const belowBand = useMemo(
    () => (below ? bandFor(below, [...others, draft]) : null),
    [below, others, draft],
  )
  const belowWas = below?.bandMaxGhs ?? null

  const alignToLine = () => {
    setDraft((d) => ({ ...d, ...benefitsBetween(d.priceGhs, others) }))
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
      paidCount: plan?.paidCount ?? 0,
      paidAboveFloor: plan?.paidAboveFloor ?? 0,
      paidAvgGhs: plan?.paidAvgGhs ?? null,
      /* Carried, never computed here. The save returns the refreshed list and
         that is what gets rendered, so the authoritative band arrives from
         `plan_band_max_minor` a moment later. */
      bandMaxGhs: plan?.bandMaxGhs ?? null,
    })
  }

  const err = (field: string) => (showErrors ? errors[field] : undefined)

  const ghs = (n: number) => `GHS ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  /* Floored to whole cedis. The band really ends at GHS 139.99, and rounding
     that prints the next plan's own price, which reads as an overlap. */
  const top = band ? Math.floor(band.toGhs) : null
  /* GROUPED, like every other figure on this screen. A bare `{to}` in an ICU
     message is substituted rather than number-formatted, so passing the raw
     number printed "GHS 1000" in the band line while the table beside it and
     the sentence below it both said "GHS 1,000" — the same amount, spelled two
     ways, in one panel. Only visible once a plan's ceiling passed a thousand,
     which nothing on the ladder did until the top plan got a band. */
  const topLabel = (top ?? draft.priceGhs).toLocaleString()

  /* The band, and what a buyer moving across it actually changes. An element
     rather than a component: declaring a component inside render remounts it —
     and its state — on every keystroke, which is exactly the field this thing
     reacts to. */
  const bandBox =
    draft.priceGhs > 0 && draft.status === 'live' ? (
      <div
        className={cn(
          'mt-3 rounded-(--radius-card) border p-3.5',
          check.ok
            ? 'border-brand-600/25 bg-brand-50/50'
            : check.problems.includes('unbuyable')
              ? 'border-danger-500/30 bg-danger-50'
              : 'border-warning-500/30 bg-warning-50',
        )}
      >
        <p
          className={cn(
            'flex items-center gap-1.5 text-[0.8125rem] font-semibold',
            check.ok
              ? 'text-brand-700'
              : check.problems.includes('unbuyable')
                ? 'text-danger-700'
                : 'text-warning-600',
          )}
        >
          {check.ok ? (
            <Check aria-hidden className="size-4 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
          )}
          {check.ok
            ? band?.isTop && draft.ownBandMaxGhs === null
              ? t('band.topTitle')
              : t('band.title', { from: ghs(draft.priceGhs), to: topLabel })
            : t(`bandWarn.${check.problems.includes('unbuyable') ? 'unbuyable' : check.problems[0]!}.short`)}
        </p>

        <p
          className={cn(
            'mt-1.5 text-[0.75rem] leading-relaxed',
            check.ok ? 'text-ink-600' : 'text-warning-600/90',
          )}
        >
          {!check.ok
            ? t(
                `bandWarn.${check.problems.includes('unbuyable') ? 'unbuyable' : check.problems[0]!}.body`,
                { next: check.next?.name ?? '', name: draft.name || t('panel.newTitle') },
              )
            : /* A CEILING OF ITS OWN COMES FIRST, on any rung. A band that
                 carries one climbs towards a NUMBER, not towards the plan
                 above, so naming the next plan here would quote a rate the
                 database will not pay. This branch used to be reachable only
                 at the top, which is why the live ladder's middle rungs each
                 described themselves as sliding towards the plan above while
                 stopping short of it. */
              draft.ownBandMaxGhs !== null
              ? t('band.rangeBody', {
                  from: draft.rewardMultiplier,
                  to: draft.ownBandMaxMultiplier ?? draft.rewardMultiplier,
                  price: ghs(draft.ownBandMaxGhs),
                  ads: draft.dailyAdCap,
                })
              : band?.isTop
                ? t('band.topBody', { price: ghs(draft.priceGhs) })
                : t('band.body', {
                    from: draft.rewardMultiplier,
                    to: check.next?.rewardMultiplier ?? draft.rewardMultiplier,
                    next: check.next?.name ?? '',
                    ads: draft.dailyAdCap,
                  })}
        </p>

        {/* What one cedi buys here. Shown, never judged: the ladder gives less
            per cedi as it climbs, and that is a decision, not a defect. */}
        {check.ok && !band?.isTop && (
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-500">
            {t('band.perCedi', { pct: earningPerCedi(draft) })}
          </p>
        )}

        {/* The concrete harm, when there is one to name. */}
        {undercut && (
          <p className="mt-2 rounded-(--radius-input) bg-warning-500/10 px-2.5 py-2 text-[0.75rem] leading-relaxed font-medium text-warning-600">
            {t('bandWarn.undercut', {
              plans: undercut.names.join(' + '),
              price: undercut.priceGhs,
              ads: undercut.dailyAdCap,
              multiplier: undercut.rewardMultiplier,
            })}
          </p>
        )}

        {/* Offered ONLY for the two inversions, which putting the benefits on
            the line genuinely resolves. An empty band is a PRICE problem —
            rewriting the ads and the rate would leave the plan just as
            unsellable, and a button that does not do what it says is worse
            than no button. A band that runs backwards inside itself is the
            same story: `benefitsBetween` returns an ad cap and a floor rate
            and never touches the ceiling, so it cannot fix that one either.
            The warning above says exactly what to change. */}
        {!check.ok &&
          !check.problems.includes('unbuyable') &&
          !check.problems.includes('rangeInversion') && (
          <button
            type="button"
            onClick={alignToLine}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-(--radius-input) border border-warning-500/40 bg-surface px-2.5 py-1.5 text-[0.75rem] font-semibold text-warning-600 transition-colors hover:bg-warning-50"
          >
            <Wand2 aria-hidden className="size-3.5" />
            {t('bandWarn.fix')}
          </button>
        )}
      </div>
    ) : null

  /* What this price does to the plan BELOW. Only when it actually moves it,
     so an operator editing anything else is not told about a neighbour that
     has not changed. */
  const neighbourBox =
    below && belowBand && belowWas !== null && Math.floor(belowBand.toGhs) !== Math.floor(belowWas) ? (
      <p className="mt-2.5 rounded-(--radius-input) border border-ink-200 bg-ink-50/60 px-2.5 py-2 text-[0.75rem] leading-relaxed text-ink-600">
        {t('band.neighbour', {
          name: below.name,
          from: ghs(below.priceGhs),
          was: Math.floor(belowWas),
          to: Math.floor(belowBand.toGhs),
        })}
      </p>
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
            hint={t('fields.priceHint')}
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

        {/* ---- A rung's own ceiling --------------------------------------
            OFFERED ON EVERY PRICED RUNG, not only the top. It was top-only on
            the reasoning that a middle rung's band ends at the plan above it,
            so a stored ceiling would be a setting the database throws away.
            Migration 189 ended that: the ladder gained GAPS, Bronze sells
            GHS 85 to 105 while Silver starts at 145, and both
            `plan_band_max_minor` and `plan_multiplier_for_amount` now read a
            rung's OWN ceiling first wherever it has one.

            `bandFor` and the save path moved with the functions. This panel
            did not, so five of the six live plans carried a ceiling and a top
            rate that decided what every buyer earned and that nothing on this
            screen could edit.

            Both or neither, which the table enforces as a constraint: a
            ceiling with no rate to climb towards cannot be priced, and a rate
            with no ceiling is a number nothing reads. */}
        {draft.priceGhs > 0 && (
          <div className="mt-3">
            <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-700">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
                checked={draft.ownBandMaxGhs !== null}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    /* Opening it suggests the band the database would have
                       used anyway, so the honest answer is the one you get by
                       doing nothing. Below the top that is one pesewa under
                       the next plan, climbing to the next plan's rate, which
                       is exactly the fallback in `plan_band_max_minor`. At the
                       top there is no next plan to borrow from, so it stays
                       double the floor. Closing it clears BOTH, because a
                       half-set pair is refused by the database. */
                    ownBandMaxGhs: e.target.checked
                      ? check.next
                        ? Math.round((check.next.priceGhs - 0.01) * 100) / 100
                        : d.priceGhs * 2
                      : null,
                    ownBandMaxMultiplier: e.target.checked
                      ? (check.next?.rewardMultiplier ??
                        Math.round(d.rewardMultiplier * 1000 * 2 - 1000) / 1000)
                      : null,
                  }))
                }
              />
              <span>
                {t('fields.topBand')}
                <span className="mt-0.5 block text-[0.75rem] text-ink-500">
                  {band?.isTop ? t('fields.topBandHint') : t('fields.bandHint')}
                </span>
              </span>
            </label>

            {draft.ownBandMaxGhs !== null && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={t('fields.topBandMax')} suffix="GHS">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={draft.priceGhs}
                    value={draft.ownBandMaxGhs}
                    onChange={(e) => set('ownBandMaxGhs', Number(e.target.value))}
                    className={inputClass(false)}
                  />
                </Field>
                <Field label={t('fields.topBandRate')} suffix="×">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={draft.rewardMultiplier}
                    value={draft.ownBandMaxMultiplier ?? draft.rewardMultiplier}
                    onChange={(e) => set('ownBandMaxMultiplier', Number(e.target.value))}
                    className={inputClass(false)}
                  />
                </Field>
              </div>
            )}
          </div>
        )}

        {/* The range this floor really sells at, and — the part nobody would
            guess — what moving it does to the plan underneath. */}
        {band && !band.empty && (
          <p className="mt-2.5 text-[0.75rem] leading-relaxed text-ink-600">
            {band.isTop
              ? draft.ownBandMaxGhs !== null
                ? t('band.line', { from: ghs(draft.priceGhs), to: topLabel })
                : t('band.topLine', { price: ghs(draft.priceGhs) })
              : t('band.line', { from: ghs(draft.priceGhs), to: topLabel })}
          </p>
        )}
        {neighbourBox}
      </PanelSection>

      {/* ---- Benefits --------------------------------------------------- */}
      <PanelSection label={t('panel.benefits')}>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('fields.dailyAdCap')}
            hint={t('fields.dailyAdCapHint', { free })}
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

        {/* The band verdict lives under the PRICE, which is what cuts it,
            but the two fields that can invert it are here — so it is repeated
            where the damage is done. Directly under them rather than at the
            end of the section: on a laptop the rest of the perks push it below
            the fold, and an operator typing into "Ads a day" could not see
            what their number had just done. */}
        {bandBox}

        {/* The withdrawal threshold used to be here. Operator, 2026-08-01:
            "no plan should have its own withdrawal threshold" — it is one
            number for the whole platform now, in Settings, and a field here
            would be a field that changes nothing. The column still holds what
            this plan used to promise, and nothing reads it. */}
        <div className="mt-3 grid grid-cols-2 gap-3">
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
