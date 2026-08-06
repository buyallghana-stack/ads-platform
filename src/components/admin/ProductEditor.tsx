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
import { saveProductAction, setProductStatusAction } from '@/app/[locale]/admin/(super)/catalogue/actions'

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
