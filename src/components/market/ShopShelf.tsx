import { BookOpen, GraduationCap, Store } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import type { ShopProduct } from '@/lib/market/data'

/**
 * The shop.
 *
 * DESIGN.md call 5: a curated shelf, not a marketplace.
 *
 * Marketplace chrome — search-first, filter rails, star ratings, "12,481
 * students" — exists to make thousands of items navigable and to substitute for
 * trust between strangers. This is a closed vendor network the operator
 * personally enlists, which is tens of products. Copy that chrome onto ten
 * items and the shop looks abandoned.
 *
 * So: cover-led cards, grouped by what they are. No ratings and no enrolment
 * counts — nothing in the schema stores them, and an empty five-star row reads
 * as broken rather than as new.
 *
 * The AFFILIATE TIER REQUIREMENT is on the card rather than buried in the
 * detail page, because an affiliate browsing for something to promote is asking
 * exactly that question and should not have to open six pages to answer it.
 */
export async function ShopShelf({ products }: { products: ShopProduct[] }) {
  const t = await getTranslations('market.shop')

  if (products.length === 0) {
    return (
      <div className="rounded-(--radius-card) border border-dashed border-ink-300 bg-surface px-4 py-12 text-center">
        <Store aria-hidden className="mx-auto size-6 text-ink-400" />
        <p className="mt-3 text-sm font-semibold text-ink-900">{t('empty.title')}</p>
        <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-600">
          {t('empty.body')}
        </p>
      </div>
    )
  }

  const training = products.filter((p) => p.purpose === 'training_program')
  const vendor = products.filter((p) => p.purpose === 'vendor_product')

  /* Resolved ONCE, not per card. `getTranslations` is async and a card is not,
     so awaiting inside the map is both invalid and — if it worked — a lookup
     per product for strings that never differ. */
  const labels = {
    owned: t('owned'),
    open: t('open'),
    lessons: (n: number) => t('lessons', { n }),
    professionalOnly: t('professionalOnly'),
    free: t('free'),
  }

  return (
    <div className="space-y-8">
      {training.length > 0 && (
        <Shelf title={t('shelf.training')} description={t('shelf.trainingBody')}>
          {training.map((product) => (
            <ProductCard key={product.id} product={product} labels={labels} />
          ))}
        </Shelf>
      )}
      {vendor.length > 0 && (
        <Shelf title={t('shelf.products')}>
          {vendor.map((product) => (
            <ProductCard key={product.id} product={product} labels={labels} />
          ))}
        </Shelf>
      )}
    </div>
  )
}

type CardLabels = {
  owned: string
  open: string
  lessons: (n: number) => string
  professionalOnly: string
  free: string
}

function Shelf({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">{title}</h2>
      {description && (
        <p className="mt-0.5 max-w-prose text-[0.8125rem] leading-snug text-ink-600">
          {description}
        </p>
      )}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function ProductCard({
  product,
  labels,
}: {
  product: ShopProduct
  labels: CardLabels
}) {
  const Icon = product.purpose === 'training_program' ? GraduationCap : BookOpen

  return (
    <Link
      href={`/shop/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface transition-colors hover:border-ink-300"
    >
      {/* Cover. No image yet on any product, so the placeholder has to be a
          deliberate design rather than a grey box — it is what every card looks
          like until covers exist. */}
      <div className="grid aspect-[16/9] place-items-center bg-gradient-to-br from-jade-50 to-brand-50">
        <Icon aria-hidden className="size-8 text-jade-600/70" strokeWidth={1.5} />
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[0.9375rem] leading-snug font-semibold text-ink-900">
            {product.title}
          </h3>
          {product.owned && (
            <Badge tone="success" className="shrink-0">
              {labels.owned}
            </Badge>
          )}
        </div>

        {product.description && (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-ink-600">
            {product.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.75rem] text-ink-500">
          {product.lessons > 0 && <span>{labels.lessons(product.lessons)}</span>}
          {/* The question an affiliate is actually asking. */}
          {product.min_affiliate_tier === 'professional' && (
            <Badge tone="neutral">{labels.professionalOnly}</Badge>
          )}
        </div>

        <div className="mt-auto flex items-baseline gap-2 pt-3">
          {product.owned ? (
            <span className="text-[0.875rem] font-semibold text-jade-700">{labels.open}</span>
          ) : (
            <>
              {product.on_sale && (
                <span className="text-[0.8125rem] text-ink-400 line-through">
                  {cedis(product.list_price_minor)}
                </span>
              )}
              <span className="text-base font-semibold tabular-nums text-ink-900">
                {product.price_minor === 0 ? labels.free : cedis(product.price_minor)}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}
