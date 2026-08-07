'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, ListTree } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { CoverUpload } from '@/components/admin/CoverUpload'
import { Field, FieldSet, FormSection, Segmented, inputClass } from '@/components/admin/FormBits'
import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { CatalogueRow, VendorRow } from '@/lib/admin/catalogue-data'
import {
  removeCommissionAction,
  saveCommissionAction,
  saveProductAction,
  setProductStatusAction,
} from '@/app/[locale]/admin/(super)/catalogue/actions'

/**
 * Product details: what it is, what it costs, and whether it can go on sale.
 *
 * The curriculum is deliberately NOT here. A course is two different jobs —
 * deciding what it is and building what is in it — done at different times and
 * often by different people, and a single screen carrying both is a screen
 * where you scroll past forty lessons to change a price.
 *
 * ---------------------------------------------------------------------------
 * THE PUBLISH CONTROL LIVES BESIDE THE REASON IT IS REFUSED
 *
 * A disabled "Publish" button that says nothing teaches the operator to click
 * it repeatedly. So the blockers are listed in the same panel, and publishing
 * is simply not offered while any remain.
 *
 * Migration 133 is why the empty-course case appears here at all: before it,
 * a course with no lessons reported zero blockers and published happily, and
 * the buyer opened an empty player having paid GHS 400 for a course they could
 * never complete — so their affiliate account could never activate.
 */
export function ProductEditor({
  product,
  vendors,
  blockers,
}: {
  product: CatalogueRow | null
  vendors: VendorRow[]
  blockers: { problem: string; lesson_title: string | null }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const creating = product === null
  const [form, setForm] = useState({
    title: product?.title ?? '',
    slug: product?.slug ?? '',
    kind: (product?.kind ?? 'course') as 'course' | 'ebook' | 'bundle',
    purpose: (product?.purpose ?? 'vendor_product') as 'vendor_product' | 'training_program',
    vendorId: '',
    priceGhs: product ? String(product.price_ghs) : '',
    salePriceGhs: product?.sale_price_ghs !== null && product ? String(product.sale_price_ghs) : '',
    minAffiliateTier: (product?.min_affiliate_tier ?? 'beginner') as 'beginner' | 'professional',
    contentLanguage: product?.content_language ?? 'en',
    description: product?.description ?? '',
    coverPath: product?.cover_path ?? null,
    category: product?.category ?? '',
    outcomes: (product?.learning_outcomes ?? []).join('\n'),
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  function save() {
    setError(null)
    start(async () => {
      const result = await saveProductAction({
        id: product?.id,
        title: form.title,
        slug: form.slug,
        kind: form.kind,
        purpose: creating ? form.purpose : undefined,
        vendorId: form.vendorId || null,
        priceGhs: Number(form.priceGhs || 0),
        /* '' means CLEAR the sale, which is a different instruction from
           "leave it alone" — the RPC keys off whether the field is present,
           so null has to travel rather than being dropped. */
        salePriceGhs: form.salePriceGhs === '' ? null : Number(form.salePriceGhs),
        minAffiliateTier: form.minAffiliateTier,
        contentLanguage: form.contentLanguage,
        description: form.description || undefined,
        coverPath: form.coverPath,
        category: form.category || null,
        /* One outcome per line. A repeater with add/remove buttons is the
           obvious control and the slower one — the operator is writing four
           short lines, and a textarea lets them paste, reorder and rewrite in
           one motion. Blank lines are dropped in Postgres. */
        outcomes: form.outcomes.split('\n').map((l) => l.trim()).filter(Boolean),
      })
      if (!result.ok) return setError(result.message)
      router.push(`/admin/catalogue/${result.data.id}`)
      router.refresh()
    })
  }

  function setStatus(status: 'draft' | 'published' | 'paused') {
    if (!product) return
    setError(null)
    start(async () => {
      const result = await setProductStatusAction(product.id, status)
      if (!result.ok) return setError(result.message)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700"
        >
          {error}
        </p>
      )}

      {product && (
        <PublishPanel
          product={product}
          blockers={blockers}
          pending={pending}
          onSetStatus={setStatus}
        />
      )}

      <FormSection title="What it is">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <input
              className={inputClass()}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Affiliate Training — Professional"
            />
          </Field>

          <Field
            label="Short name"
            hint={
              creating
                ? 'Lowercase letters, numbers and hyphens. This goes in the URL and cannot be changed later.'
                : 'Fixed once created — it is in every affiliate link pointing at this product.'
            }
          >
            <input
              className={inputClass()}
              value={form.slug}
              disabled={!creating}
              onChange={(e) => set('slug', e.target.value)}
              placeholder="sales-mastery"
            />
          </Field>

          <FieldSet label="Kind">
            <Segmented
              value={form.kind}
              onChange={(v) => set('kind', v)}
              options={[
                { value: 'course', label: 'Course' },
                { value: 'ebook', label: 'Ebook' },
                { value: 'bundle', label: 'Bundle' },
              ]}
              label="Kind"
            />
          </FieldSet>

          {creating && (
            <FieldSet
              label="Purpose"
              hint="Training sells the right to promote. A vendor product is something a buyer just wants."
              className="sm:col-span-2"
            >
              <Segmented
                value={form.purpose}
                onChange={(v) => set('purpose', v)}
                options={[
                  { value: 'vendor_product', label: 'Vendor product' },
                  { value: 'training_program', label: 'Affiliate training' },
                ]}
                label="Purpose"
              />
            </FieldSet>
          )}

          <Field label="Vendor" hint="Leave blank for your own training courses.">
            <select
              className={inputClass()}
              value={form.vendorId}
              onChange={(e) => set('vendorId', e.target.value)}
            >
              <option value="">No vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Language">
            <select
              className={inputClass()}
              value={form.contentLanguage}
              onChange={(e) => set('contentLanguage', e.target.value)}
            >
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="How it looks in the shop"
        description="The cover is the first thing anyone sees. Everything here is what a buyer reads before deciding."
      >
        <div className="space-y-4">
          <FieldSet label="Cover image">
            <CoverUpload
              productId={product?.id ?? null}
              path={form.coverPath}
              onChange={(coverPath) => set('coverPath', coverPath)}
            />
          </FieldSet>

          <Field
            label="Description"
            hint="Two lines at most — it is shown on the card and above the fold."
          >
            <textarea
              rows={3}
              className={cn(inputClass(), 'resize-y')}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Topic" hint="Shown as a chip on the card, and groups the shop.">
              <input
                className={inputClass()}
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                placeholder="Affiliate marketing"
              />
            </Field>
          </div>

          <Field
            label="What they will learn"
            hint="One per line. Each should be a thing the buyer can DO afterwards, not a topic the course covers."
          >
            <textarea
              rows={5}
              className={cn(inputClass(), 'resize-y')}
              value={form.outcomes}
              onChange={(e) => set('outcomes', e.target.value)}
              placeholder={'Explain how commission is calculated\nShare a link that is credited to you'}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Price"
        description="Commission is charged on what the buyer actually pays, so a sale reduces the commission with it."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price" suffix="GHS">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={cn(inputClass(), 'tabular-nums')}
              value={form.priceGhs}
              onChange={(e) => set('priceGhs', e.target.value)}
            />
          </Field>

          <Field label="Sale price" suffix="GHS" hint="Leave blank for no sale.">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={cn(inputClass(), 'tabular-nums')}
              value={form.salePriceGhs}
              onChange={(e) => set('salePriceGhs', e.target.value)}
            />
          </Field>

          <FieldSet
            label="Who can promote it"
            hint="Professional restricts it to the higher training level."
          >
            <Segmented
              value={form.minAffiliateTier}
              onChange={(v) => set('minAffiliateTier', v)}
              options={[
                { value: 'beginner', label: 'Any affiliate' },
                { value: 'professional', label: 'Professional' },
              ]}
              label="Who can promote it"
            />
          </FieldSet>
        </div>
      </FormSection>

      {/* Commission is only offered on a product that EXISTS. Creating writes
          the product first; there is no id to hang a programme on until then,
          and a rate typed into a form that has not been saved is a rate the
          operator believes they set. */}
      {product && <CommissionSection product={product} />}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : creating ? 'Create product' : 'Save changes'}
        </button>

        {product && (
          <Link
            href={`/admin/catalogue/${product.id}/curriculum`}
            className="inline-flex items-center gap-2 rounded-(--radius-input) border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-800 transition-colors hover:border-ink-300"
          >
            <ListTree aria-hidden className="size-4" />
            {product.lessons > 0 ? `Curriculum (${product.lessons})` : 'Build the curriculum'}
          </Link>
        )}
      </div>
    </div>
  )
}

function PublishPanel({
  product,
  blockers,
  pending,
  onSetStatus,
}: {
  product: CatalogueRow
  blockers: { problem: string; lesson_title: string | null }[]
  pending: boolean
  onSetStatus: (status: 'draft' | 'published' | 'paused') => void
}) {
  const ready = blockers.length === 0

  return (
    <div className="rounded-(--radius-card) border border-ink-200 bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Badge
            tone={product.status === 'published' ? 'success' : product.status === 'paused' ? 'warning' : 'neutral'}
            dot
            className="capitalize"
          >
            {product.status}
          </Badge>
          {product.status === 'published' && (
            <a
              href={`/shop/${product.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-700 hover:underline"
            >
              View in shop
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
        </div>

        <div className="flex gap-2">
          {product.status !== 'published' && (
            <button
              type="button"
              onClick={() => onSetStatus('published')}
              disabled={pending || !ready}
              title={ready ? undefined : 'Fix everything below first'}
              className="rounded-(--radius-input) bg-success-600 px-3.5 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-success-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Publish
            </button>
          )}
          {product.status === 'published' && (
            <button
              type="button"
              onClick={() => onSetStatus('paused')}
              disabled={pending}
              className="rounded-(--radius-input) border border-ink-200 px-3.5 py-2 text-[0.8125rem] font-semibold text-ink-800 transition-colors hover:border-ink-300 disabled:opacity-50"
            >
              Pause sales
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {ready ? (
          <p className="flex items-center gap-2 text-[0.8125rem] text-success-700">
            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            {product.status === 'published'
              ? 'On sale, and everything in it is complete.'
              : 'Everything is complete. This can go on sale.'}
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-warning-600">
              <AlertTriangle aria-hidden className="size-4 shrink-0" />
              {blockers.length} thing{blockers.length === 1 ? '' : 's'} to fix before this can go
              on sale
            </p>
            {/* Every blocker, not just the first. An operator fixing them one
                at a time, discovering the next only after saving, is the
                version of this that wastes an afternoon. */}
            <ul className="mt-2 space-y-1">
              {blockers.map((b, i) => (
                <li key={i} className="text-[0.8125rem] text-ink-600">
                  {b.lesson_title && (
                    <span className="font-medium text-ink-800">{b.lesson_title}: </span>
                  )}
                  {b.problem}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * What this product pays an affiliate.
 *
 * ⚠️ ITS OWN FORM, SAVED ON ITS OWN. Commission lives in a different table
 * with different constraints, and folding it into the product save would mean
 * a typo in the rate refusing a title change. It is also the one section here
 * that touches money somebody will be paid, which is worth a deliberate act.
 *
 * ── NO PROGRAMME IS NOT 0% ──
 *
 * A product with no `affiliate_programs` row is not in the marketplace at all:
 * no affiliate can promote it and the shop card has no rate to show. A
 * programme paying 0% is a product that CAN be promoted and pays nothing for
 * it. Both are things an operator wants, so the form distinguishes them and
 * Remove is a separate action from setting zero.
 *
 * ── THE SENTENCE IS THE POINT ──
 *
 * Percentages are hard to feel. The live line underneath turns the two rates
 * into three cash figures at this product's actual price, including what the
 * platform keeps — which is the number an operator is really deciding, and the
 * one a percentage field never shows them.
 */
function CommissionSection({ product }: { product: CatalogueRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const existing = product.l1_rate !== null
  const [rates, setRates] = useState({
    l1: existing ? String(product.l1_rate) : '',
    l2: existing ? String(product.l2_rate ?? 0) : '',
    windowHours: String(product.attribution_window_hours ?? 720),
    holdDays: String(product.hold_days ?? 0),
    active: product.commission_status !== 'paused',
  })

  const l1 = Number(rates.l1)
  const l2 = Number(rates.l2)
  const valid =
    Number.isFinite(l1) && Number.isFinite(l2) && l1 >= 0 && l2 >= 0 && l1 + l2 <= 100

  /* The effective price, not the list price: commission is charged on what the
     buyer actually pays, so a product on sale pays less and the operator
     should be looking at the figure their affiliates will see. */
  const price = product.effective_price_ghs
  const cash = (percent: number) => (price * percent) / 100
  const money = (n: number) => `GHS ${n.toFixed(2)}`

  function save() {
    setError(null)
    setSaved(false)
    start(async () => {
      const result = await saveCommissionAction({
        productId: product.id,
        l1,
        l2,
        windowHours: Number(rates.windowHours),
        holdDays: Number(rates.holdDays),
        active: rates.active,
      })
      if (!result.ok) return setError(result.message)
      setSaved(true)
      router.refresh()
    })
  }

  function remove() {
    setError(null)
    setSaved(false)
    start(async () => {
      const result = await removeCommissionAction(product.id)
      if (!result.ok) return setError(result.message)
      setRates((r) => ({ ...r, l1: '', l2: '' }))
      router.refresh()
    })
  }

  return (
    <FormSection
      title="Commission"
      description="What an affiliate earns for selling this. Rates apply to new sales only: what somebody has already been paid is frozen on the sale it came from."
    >
      {!existing && (
        <p className="mb-4 rounded-(--radius-input) border border-warning-500/25 bg-warning-50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-warning-600">
          No commission is set, so this product is not in the affiliate
          marketplace. Nobody can promote it and nobody earns on it.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level one" suffix="%" hint="The affiliate who made the sale.">
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            max="100"
            className={cn(inputClass(), 'tabular-nums')}
            value={rates.l1}
            onChange={(e) => setRates((r) => ({ ...r, l1: e.target.value }))}
          />
        </Field>

        <Field
          label="Level two"
          suffix="%"
          hint="Whoever recruited that affiliate. Zero is fine."
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            max="100"
            className={cn(inputClass(), 'tabular-nums')}
            value={rates.l2}
            onChange={(e) => setRates((r) => ({ ...r, l2: e.target.value }))}
          />
        </Field>
      </div>

      {valid && price > 0 && (rates.l1 !== '' || rates.l2 !== '') && (
        <p className="mt-3 rounded-(--radius-input) bg-ink-50 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-700">
          On one sale at <strong className="text-ink-900">{money(price)}</strong>, the
          affiliate earns <strong className="text-ink-900">{money(cash(l1))}</strong>
          {l2 > 0 && (
            <>
              , their recruiter earns <strong className="text-ink-900">{money(cash(l2))}</strong>
            </>
          )}
          , and you keep{' '}
          <strong className="text-ink-900">{money(price - cash(l1) - cash(l2))}</strong>.
        </p>
      )}

      {!valid && (
        <p className="mt-3 text-[0.8125rem] text-danger-700">
          The two levels together cannot be more than 100%.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Attribution window"
          suffix="hours"
          hint="How long after a click a purchase still counts. 720 is 30 days."
        >
          <input
            type="number"
            inputMode="numeric"
            min="1"
            className={cn(inputClass(), 'tabular-nums')}
            value={rates.windowHours}
            onChange={(e) => setRates((r) => ({ ...r, windowHours: e.target.value }))}
          />
        </Field>

        <Field
          label="Hold before payable"
          suffix="days"
          hint="Commission is credited straight away and cannot be withdrawn until the hold passes. Zero means no hold."
        >
          <input
            type="number"
            inputMode="numeric"
            min="0"
            className={cn(inputClass(), 'tabular-nums')}
            value={rates.holdDays}
            onChange={(e) => setRates((r) => ({ ...r, holdDays: e.target.value }))}
          />
        </Field>
      </div>

      {error && (
        <p className="mt-3 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-3 text-[0.8125rem] font-medium text-success-600">Commission saved.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !valid || rates.l1 === ''}
          className="rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : existing ? 'Save commission' : 'Set commission'}
        </button>

        {existing && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-(--radius-input) border border-ink-200 px-4 py-2.5 text-sm font-semibold text-danger-700 transition-colors hover:border-danger-500/40 hover:bg-danger-50 disabled:opacity-50"
          >
            Remove from the marketplace
          </button>
        )}
      </div>
    </FormSection>
  )
}
