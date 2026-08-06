import { BookOpen, Lock, Share2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { SaveButton } from '@/components/affiliate/SaveButton'
import { Link } from '@/i18n/navigation'
import { coverUrl } from '@/lib/market/covers'
import type { ShopProduct } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * One product in the affiliate marketplace.
 *
 * ── THE CARD IS BUILT AROUND THE COMMISSION, NOT THE PRODUCT ──
 *
 * On a shop card the price is the headline. Here it is not: an affiliate is
 * not buying, and what the customer pays is only interesting as the thing the
 * rate is a percentage OF. So the money block is the rate and the cash, and the
 * price appears beneath them in a smaller size as context.
 *
 * The two figures are given different weights on purpose. "30%" is comparable
 * between products and "GHS 60.00" is not — a 20% rate on a GHS 400 product
 * beats a 35% rate on a GHS 100 one — so the cash is the larger of the two,
 * because it is the number that actually ranks the grid.
 *
 * ── OWNED PRODUCTS LOOK DIFFERENT ──
 *
 * The same grid serves somebody browsing to learn and somebody browsing to
 * promote, and a course they already own must not offer "Buy". Owned cards
 * swap the money block for their progress and the button for "Continue".
 *
 * ── NO RATINGS, NO "TRENDING" ──
 *
 * The reference has both. We have neither a review system nor enough sales for
 * a popularity signal, and a badge that is decided by nothing is worse than no
 * badge — it teaches the reader that the labels on this screen are decorative.
 * The honest signals we DO have are on the card instead: lesson count, whether
 * a certificate is issued, and what it pays.
 */
export async function ProductCard({ product }: { product: ShopProduct }) {
  const t = await getTranslations('affiliate.market')
  const cover = coverUrl(product.cover_path)
  const training = product.purpose === 'training_program'

  return (
    <article className="group flex flex-col overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface transition-colors hover:border-ink-300">
      {/* Cover. Fixed aspect so a grid of mixed uploads does not stagger. */}
      <div className="relative aspect-[16/9] shrink-0 overflow-hidden bg-ink-100">
        {cover ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span aria-hidden className="grid size-full place-items-center text-ink-400">
            <BookOpen className="size-8" strokeWidth={1.5} />
          </span>
        )}

        {/* A scrim under the chips, not over the whole image: chips sit on the
            corners and the middle of a cover is where its own type usually is. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent"
        />

        {product.category && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-sm">
            {product.category}
          </span>
        )}

        <div className="absolute right-2.5 top-2.5">
          <SaveButton productId={product.id} saved={product.saved} title={product.title} />
        </div>

        {product.on_sale && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-success-500 px-2.5 py-1 text-[0.6875rem] font-bold text-white">
            {t('onSale')}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-ink-900">
          <Link href={`/shop/${product.slug}`} className="hover:text-brand-700">
            {product.title}
          </Link>
        </h3>

        {product.description && (
          <p className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-snug text-ink-500">
            {product.description}
          </p>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-ink-500">
          <span>{t('lessons', { n: product.lessons })}</span>
          {product.quizzes > 0 && <span>{t('checkpoints', { n: product.quizzes })}</span>}
        </p>

        {/* ── the money, or the progress ─────────────────────────────── */}
        <div className="mt-3 border-t border-ink-200 pt-3">
          {product.owned ? (
            <>
              <div className="flex items-center justify-between text-[0.75rem]">
                <span className="text-ink-500">{t('yourProgress')}</span>
                <span className="font-semibold tabular-nums text-ink-900">{product.percent}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-success-500"
                  style={{ width: `${Math.min(Math.max(product.percent, 0), 100)}%` }}
                />
              </div>
            </>
          ) : (
            /*
              Two across on a phone leaves roughly 165px inside a card, which
              is not enough for two money blocks side by side — so they stack
              below `sm` and sit shoulder to shoulder above it.

              The CASH stays the larger of the two at every width. It is the
              figure that ranks the grid: 20% of GHS 400 beats 35% of GHS 100,
              so a reader comparing percentages is comparing the wrong number.
            */
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <div className="flex items-baseline justify-between gap-2 sm:block">
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-ink-500">
                  {t('commission')}
                </p>
                <p className="text-[0.9375rem] font-semibold tabular-nums text-success-600">
                  {product.l1_rate === null ? '—' : `${Number(product.l1_rate)}%`}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-ink-500">
                  {t('perSale')}
                </p>
                <p className="text-[1.0625rem] font-bold leading-none tabular-nums text-ink-900">
                  {product.l1_earn_minor === null ? '—' : cedis(product.l1_earn_minor)}
                </p>
                <p className="mt-1 text-[0.6875rem] tabular-nums text-ink-500">
                  {t('sellsFor', { amount: cedis(product.price_minor) })}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── the action ───────────────────────────────────────────────
            `mt-auto` pins it to the bottom of the card. Two across, one card
            carrying a progress bar and its neighbour carrying a money block,
            the two blocks are different heights — so without this the primary
            buttons sit at different heights in the same row, which reads as a
            rendering fault before it reads as content. The grid already
            stretches the cards to match; this makes the contents agree. */}
        <div className="mt-auto flex items-center gap-2 pt-3">
          {product.owned ? (
            <Link
              href={`/learn/${product.slug}`}
              className="flex-1 rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-center text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-500"
            >
              {product.percent > 0 ? t('continue') : t('start')}
            </Link>
          ) : (
            <Link
              href={`/shop/${product.slug}`}
              className={cn(
                'flex-1 rounded-(--radius-input) px-4 py-2.5 text-center text-[0.8125rem] font-semibold transition-colors',
                product.can_promote
                  ? 'bg-brand-600 text-white hover:bg-brand-500'
                  : 'border border-ink-300 text-ink-700 hover:border-brand-600/50 hover:text-brand-700',
              )}
            >
              {product.can_promote ? t('promote') : training ? t('view') : t('viewProduct')}
            </Link>
          )}

          {/* Share goes to the product page rather than copying here. A copied
              link has to carry the affiliate code, and a card that silently
              copies something is a card that can silently copy the wrong
              thing — the promote panel shows the link before it is shared.

              Hidden below `sm`: two cards across leaves no room for it beside
              the primary action, and it is a shortcut to the same place that
              button already goes. A 40px square squeezed against a 100px button
              is a mis-tap, not an affordance. */}
          <Link
            href={`/shop/${product.slug}#promote`}
            aria-label={t('shareLabel', { title: product.title })}
            className="hidden size-10 shrink-0 place-items-center rounded-(--radius-input) border border-ink-200 text-ink-600 transition-colors hover:border-brand-600/50 hover:text-brand-700 sm:grid"
          >
            {product.can_promote || product.owned ? (
              <Share2 aria-hidden className="size-4" />
            ) : (
              <Lock aria-hidden className="size-4" />
            )}
          </Link>
        </div>
      </div>
    </article>
  )
}
