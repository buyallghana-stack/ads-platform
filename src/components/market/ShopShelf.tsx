import Image from 'next/image'
import { BookOpen, GraduationCap, HelpCircle, PlayCircle, Store } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { courseLength, coverUrl } from '@/lib/market/covers'
import { cedis } from '@/lib/market/money'
import type { ShopProduct } from '@/lib/market/data'

/**
 * The shop.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WAS REBUILT
 *
 * The first version was a skeleton next to the references: a pale gradient
 * where the artwork should be, a title, and a price. Each omission had a
 * reason — no covers uploaded, no ratings in the schema — and together they
 * left a card with nothing on it to look at.
 *
 * The worst was self-inflicted. `products.cover_path` has existed since
 * migration 107 and the shop read already returned it; nothing ever WROTE to
 * it because the admin editor had no upload, so the card rendered a placeholder
 * and a comment called that a design decision. It was a missing feature with an
 * excuse attached.
 *
 * A card now carries what every reference card carries: artwork, a topic, who
 * made it, how long it is, how much is in it, and the price. Everything here is
 * real data — nothing is invented to fill the layout.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STILL DELIBERATELY ABSENT
 *
 * Ratings and review counts. The references have them because they have
 * reviewers; nothing in this schema generates one, and a five-star row on a
 * product nobody has reviewed is fabricated social proof attached to something
 * being sold for real money. That is the one gap that will not be closed by
 * rendering harder.
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

  const labels = {
    owned: t('owned'),
    open: t('open'),
    free: t('free'),
    professionalOnly: t('professionalOnly'),
    continueLabel: t('continue'),
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
  free: string
  professionalOnly: string
  continueLabel: string
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
  const cover = coverUrl(product.cover_path)
  const length = courseLength(product.seconds)
  const Icon = product.purpose === 'training_program' ? GraduationCap : BookOpen

  return (
    <Link
      href={`/shop/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.18)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-ink-100">
        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          /* Only when a product genuinely has no cover yet. Not a design
             choice — a prompt to the operator that one is missing. */
          <span className="grid size-full place-items-center">
            <Icon aria-hidden className="size-9 text-ink-400" strokeWidth={1.25} />
          </span>
        )}

        {product.category && (
          <span className="absolute left-3 top-3 rounded-full bg-surface/95 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-800 backdrop-blur-sm">
            {product.category}
          </span>
        )}
        {product.min_affiliate_tier === 'professional' && (
          <span className="absolute right-3 top-3 rounded-full bg-ink-900/85 px-2.5 py-1 text-[0.6875rem] font-semibold text-white backdrop-blur-sm">
            {labels.professionalOnly}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[1rem] leading-snug font-semibold tracking-[-0.01em] text-ink-900">
          {product.title}
        </h3>

        {product.vendor_name && (
          <p className="mt-1 text-[0.8125rem] text-ink-600">{product.vendor_name}</p>
        )}

        {product.description && (
          <p className="mt-1.5 line-clamp-2 text-[0.875rem] leading-snug text-ink-600">
            {product.description}
          </p>
        )}

        {/* The metadata row every reference card carries: how long, how much is
            in it, and how many checkpoints. All real, all derived. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-ink-500">
          {length && (
            <span className="inline-flex items-center gap-1">
              <PlayCircle aria-hidden className="size-3.5" />
              {length}
            </span>
          )}
          {product.lessons > 0 && <span>{product.lessons} lessons</span>}
          {product.quizzes > 0 && (
            <span className="inline-flex items-center gap-1">
              <HelpCircle aria-hidden className="size-3.5" />
              {product.quizzes}
            </span>
          )}
        </div>

        {product.owned ? (
          <div className="mt-auto pt-4">
            <div className="flex items-center justify-between text-[0.75rem] font-medium">
              <span className="text-jade-700">{labels.continueLabel}</span>
              <span className="tabular-nums text-ink-500">{product.percent}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-jade-600"
                style={{ width: `${Math.min(100, product.percent)}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-auto flex items-baseline gap-2 pt-4">
            <span className="text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em] text-ink-900">
              {product.price_minor === 0 ? labels.free : cedis(product.price_minor)}
            </span>
            {product.on_sale && (
              <span className="text-[0.875rem] text-ink-400 line-through">
                {cedis(product.list_price_minor)}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}
