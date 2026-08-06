import { BookOpen, GraduationCap, Store } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import type { ShopProduct } from '@/lib/market/data'

/**
 * The shop.
 *
 * A curated shelf, not a marketplace: this is a closed vendor network the
 * operator personally enlists, so search-first chrome and star ratings would be
 * furniture for a problem we do not have. Nothing in the schema stores a rating
 * anyway, and an empty five-star row reads as broken rather than as new.
 *
 * Rebuilt in the market skin (DESIGN.md): larger covers, softer radii, and the
 * price given room rather than tucked under a metadata line. The card is
 * cover-led because that is what the references do and because a course is
 * bought on its promise before its detail.
 */
export async function ShopShelf({ products }: { products: ShopProduct[] }) {
  const t = await getTranslations('market.shop')

  if (products.length === 0) {
    return (
      <div className="rounded-(--radius-panel) border border-dashed border-ink-300 bg-surface px-4 py-14 text-center">
        <Store aria-hidden className="mx-auto size-7 text-ink-400" strokeWidth={1.5} />
        <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{t('empty.title')}</p>
        <p className="mx-auto mt-1 max-w-sm text-[0.875rem] leading-snug text-ink-600">
          {t('empty.body')}
        </p>
      </div>
    )
  }

  const training = products.filter((p) => p.purpose === 'training_program')
  const vendor = products.filter((p) => p.purpose === 'vendor_product')

  /* Resolved once, not per card: `getTranslations` is async and a card is not. */
  const labels = {
    owned: t('owned'),
    open: t('open'),
    lessons: (n: number) => t('lessons', { n }),
    professionalOnly: t('professionalOnly'),
    free: t('free'),
  }

  return (
    <div className="space-y-9">
      {training.length > 0 && (
        <Shelf title={t('shelf.training')} description={t('shelf.trainingBody')}>
          {training.map((p) => (
            <ProductCard key={p.id} product={p} labels={labels} />
          ))}
        </Shelf>
      )}
      {vendor.length > 0 && (
        <Shelf title={t('shelf.products')}>
          {vendor.map((p) => (
            <ProductCard key={p.id} product={p} labels={labels} />
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
      <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em] text-ink-900">{title}</h2>
      {description && (
        <p className="mt-1 max-w-prose text-[0.875rem] leading-snug text-ink-600">{description}</p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function ProductCard({ product, labels }: { product: ShopProduct; labels: CardLabels }) {
  const Icon = product.purpose === 'training_program' ? GraduationCap : BookOpen

  return (
    <Link
      href={`/shop/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-ink-300"
    >
      <div className="relative grid aspect-[16/10] place-items-center bg-gradient-to-br from-jade-50 via-surface to-ink-50">
        <Icon aria-hidden className="size-9 text-jade-600/50" strokeWidth={1.25} />
        {product.owned && (
          <span className="absolute left-3 top-3 rounded-full bg-jade-600 px-2.5 py-1 text-[0.6875rem] font-semibold text-white">
            {labels.owned}
          </span>
        )}
        {product.min_affiliate_tier === 'professional' && !product.owned && (
          <span className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-700 ring-hairline">
            {labels.professionalOnly}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[1rem] leading-snug font-semibold tracking-[-0.01em] text-ink-900">
          {product.title}
        </h3>

        {product.description && (
          <p className="mt-1.5 line-clamp-2 text-[0.875rem] leading-snug text-ink-600">
            {product.description}
          </p>
        )}

        {product.lessons > 0 && (
          <p className="mt-2 text-[0.75rem] text-ink-500">{labels.lessons(product.lessons)}</p>
        )}

        <div className="mt-auto flex items-baseline gap-2 pt-4">
          {product.owned ? (
            <span className="text-[0.9375rem] font-semibold text-jade-700">{labels.open}</span>
          ) : (
            <>
              <span className="text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em] text-ink-900">
                {product.price_minor === 0 ? labels.free : cedis(product.price_minor)}
              </span>
              {product.on_sale && (
                <span className="text-[0.875rem] text-ink-400 line-through">
                  {cedis(product.list_price_minor)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </Link>
  )
}
