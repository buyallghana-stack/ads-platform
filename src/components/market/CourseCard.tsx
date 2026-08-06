import Image from 'next/image'
import { GraduationCap } from 'lucide-react'

import { SaveButton } from '@/components/market/SaveButton'
import { Link } from '@/i18n/navigation'
import { courseLength, coverUrl } from '@/lib/market/covers'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'
import type { ShopProduct } from '@/lib/market/data'

/**
 * The two card shapes from reference 0572, which uses BOTH on one screen.
 *
 *   `featured`  the big one in the horizontal carousel — cover on top, then
 *               category chip, title, instructor, and a footer of meta + price
 *   `row`       the compact one in the vertical list — square thumbnail left,
 *               everything else right
 *
 * One component rather than two because the content is identical and only the
 * arrangement differs; two files would drift the moment a field is added.
 *
 * The instructor line falls back to the platform name. Training courses
 * structurally cannot have a vendor — `products_training_has_no_vendor` — since
 * they are the Owner's own, so without a fallback every training card would
 * have a blank where the reference puts a person.
 */
export function CourseCard({
  product,
  variant = 'featured',
  platformName,
  savedLabel,
}: {
  product: ShopProduct
  variant?: 'featured' | 'row'
  platformName: string
  savedLabel: string
}) {
  const cover = coverUrl(product.cover_path)
  const length = courseLength(product.seconds)
  const instructor = product.instructor_name ?? platformName
  const price = product.price_minor === 0 ? null : cedis(product.price_minor)

  const meta = [length, product.lessons > 0 ? `${product.lessons} lessons` : null]
    .filter(Boolean)
    .join(' · ')

  if (variant === 'row') {
    return (
      <Link
        href={`/shop/${product.slug}`}
        className="flex gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-3 transition-colors hover:border-ink-300"
      >
        <span className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-xl bg-ink-100">
          {cover ? (
            <Image src={cover} alt="" fill sizes="72px" className="object-cover" />
          ) : (
            <span className="grid size-full place-items-center">
              <GraduationCap aria-hidden className="size-5 text-ink-400" strokeWidth={1.5} />
            </span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              {product.category && <CategoryChip>{product.category}</CategoryChip>}
              <span className="mt-1 block truncate text-[0.9375rem] font-semibold text-ink-900">
                {product.title}
              </span>
            </span>
            <SaveButton productId={product.id} saved={product.saved} />
          </span>

          <span className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-ink-600">
            <Avatar name={instructor} path={product.instructor_avatar} size={18} />
            <span className="truncate">{instructor}</span>
          </span>

          <span className="mt-auto flex items-baseline justify-between gap-2 pt-1.5">
            <span className="truncate text-[0.75rem] text-ink-500">{meta}</span>
            {product.owned ? (
              <span className="shrink-0 text-[0.8125rem] font-semibold text-jade-700">
                {savedLabel}
              </span>
            ) : (
              price && (
                <span className="shrink-0 text-[1rem] font-semibold tabular-nums text-ink-900">
                  {price}
                </span>
              )
            )}
          </span>
        </span>
      </Link>
    )
  }

  return (
    <Link
      href={`/shop/${product.slug}`}
      className={cn(
        'flex w-[17rem] shrink-0 snap-start flex-col overflow-hidden sm:w-auto',
        'rounded-(--radius-card) border border-ink-200 bg-surface',
        'transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-ink-300',
      )}
    >
      <span className="relative block aspect-[4/3] bg-ink-100">
        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(max-width: 640px) 272px, 33vw"
            className="object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <GraduationCap aria-hidden className="size-8 text-ink-400" strokeWidth={1.25} />
          </span>
        )}
        <SaveButton productId={product.id} saved={product.saved} className="absolute right-2 top-2" />
      </span>

      <span className="flex flex-1 flex-col p-3.5">
        {product.category && <CategoryChip>{product.category}</CategoryChip>}

        <span className="mt-1.5 line-clamp-2 text-[0.9375rem] leading-snug font-semibold text-ink-900">
          {product.title}
        </span>

        <span className="mt-1.5 flex items-center gap-2">
          <Avatar name={instructor} path={product.instructor_avatar} size={22} />
          <span className="min-w-0">
            <span className="block truncate text-[0.75rem] font-medium text-ink-800">
              {instructor}
            </span>
            {product.instructor_headline && (
              <span className="block truncate text-[0.6875rem] text-ink-500">
                {product.instructor_headline}
              </span>
            )}
          </span>
        </span>

        <span className="mt-auto flex items-baseline justify-between gap-2 pt-3">
          <span className="truncate text-[0.75rem] text-ink-500">{meta}</span>
          {product.owned ? (
            <span className="shrink-0 text-[0.875rem] font-semibold text-jade-700">
              {savedLabel}
            </span>
          ) : (
            price && (
              <span className="shrink-0 text-[1.125rem] font-semibold tabular-nums tracking-[-0.02em] text-ink-900">
                {price}
              </span>
            )
          )}
        </span>
      </span>
    </Link>
  )
}

function CategoryChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-md bg-jade-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-jade-700">
      {children}
    </span>
  )
}

/** A face, or the initial when there is no photo. The references never show a
 *  nameless row, so neither does this. */
function Avatar({
  name,
  path,
  size,
}: {
  name: string
  path: string | null
  size: number
}) {
  const url = coverUrl(path)
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-jade-100 text-[0.625rem] font-bold text-jade-700"
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  )
}
