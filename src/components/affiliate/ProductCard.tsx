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
 * badge: it teaches the reader that the labels on this screen are decorative.
 *
 * ── SIX LINES BECAME THREE (operator, 2026-08-07) ──
 *
 * The card said too much. Title, description, lesson count, checkpoint count,
 * commission, earnings, price and a button came to eight stacked blocks in a
 * 165px column, and two of those blocks were the same fact twice. The
 * reference card is title, two lines of description, one row of money, one
 * button, and it reads in about a second.
 *
 * What went, and why:
 *
 *   the price      "Sells for GHS 150.00" is what the BUYER pays. An affiliate
 *                  browsing to promote is choosing between payouts, and the
 *                  payout is already on the card. It stays on the product page,
 *                  where somebody is deciding rather than scanning.
 *   two count rows lessons and checkpoints were a line each. They are one line
 *                  now, and they are the smallest type on the card.
 *
 * The money went side by side rather than stacked. It fits: the labels are
 * short and the values are short, and stacking them was what turned a card
 * into a column.
 */
export async function ProductCard({ product }: { product: ShopProduct }) {
  const t = await getTranslations('affiliate.market')
  const cover = coverUrl(product.cover_path)
  const training = product.purpose === 'training_program'

  return (
    <article className="group flex flex-col overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface transition-colors hover:border-ink-300">
      {/* Cover. Fixed aspect so a grid of mixed uploads does not stagger, and
          4:3 rather than 16:9 (operator, 2026-08-07): the card is a fixed
          column, so the only way to give the image more room is to make it
          taller. `object-cover` keeps it proportional at any shape, so a wide
          upload is cropped rather than squashed. The card lost the description
          in the same pass, so this costs nothing in height overall. */}
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-ink-100">
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

      <div className="flex flex-1 flex-col p-3 sm:p-3.5">
        <h3 className="line-clamp-2 text-[0.875rem] font-semibold leading-snug tracking-[-0.01em] text-ink-900 sm:text-[0.9375rem]">
          <Link href={`/shop/${product.slug}`} className="hover:text-brand-700">
            {product.title}
          </Link>
        </h3>

        {/* NO DESCRIPTION (operator, 2026-08-07). Two clamped lines of prose
            was the largest block on the card and the least useful: it is the
            same sentence for every product in a range, it never fits, and the
            product page carries it in full for anybody who taps through. The
            cover took the height it gave back. */}

        {/* One line, smallest type on the card. Two rows of counts were reading
            as loudly as the money underneath them.

            The checkpoint count waits for `sm`: at two cards across it is the
            half of the line that gets cut, and a truncated "3 checkpoi…" is
            noise where a whole "10 lessons" is a fact. */}
        <p className="mt-1.5 truncate text-[0.6875rem] text-ink-400">
          {t('lessons', { n: product.lessons })}
          {product.quizzes > 0 && (
            <span className="hidden sm:inline"> · {t('checkpoints', { n: product.quizzes })}</span>
          )}
        </p>

        {/* ── the money ──────────────────────────────────────────────
            Side by side at every width, including two cards across a phone.
            Stacking them was what made this a column.

            The CASH is the larger of the two: it ranks the grid, because 20%
            of GHS 400 beats 35% of GHS 100, and a reader comparing percentages
            is comparing the wrong number.

            Nothing wraps and nothing truncates. Both labels are `nowrap` and
            the left one shortens to "Rate" on a phone, because "Commission"
            beside "GHS 30.00" set a minimum width that pushed the whole grid
            3px past a 360px screen. `overflow-hidden` on the row is the
            backstop for an extreme pairing (a 100% rate against a four-figure
            payout): clipped inside the card is contained, a sideways-scrolling
            page is not. */}
        <div className="mt-3 border-t border-ink-200 pt-3">
          <div className="flex items-end justify-between gap-1.5 overflow-hidden">
            <div className="shrink-0">
              <p className="text-[0.625rem] leading-none whitespace-nowrap text-ink-500 sm:text-[0.6875rem]">
                <span className="sm:hidden">{t('rateShort')}</span>
                <span className="hidden sm:inline">{t('commission')}</span>
              </p>
              <p className="mt-1 text-[0.875rem] font-semibold leading-none tabular-nums text-success-600 sm:text-[0.9375rem]">
                {product.l1_rate === null ? '0%' : `${Number(product.l1_rate)}%`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.625rem] leading-none whitespace-nowrap text-ink-500 sm:text-[0.6875rem]">
                {t('perSale')}
              </p>
              <p className="mt-1 text-[0.9375rem] font-bold leading-none whitespace-nowrap tabular-nums text-ink-900 sm:text-[1rem]">
                {product.l1_earn_minor === null ? cedis(0) : cedis(product.l1_earn_minor)}
              </p>
            </div>
          </div>
        </div>

        {/* ── the action ───────────────────────────────────────────────
            `mt-auto` pins it to the bottom, so the primary buttons line up
            across a row whose cards have titles of different lengths. The grid
            already stretches the cards to match; this makes their contents
            agree.

            There is no "Continue" here any more: an owned course never reaches
            this component, because /shop filters it out (operator, 2026-08-07).
            Owned courses belong on Learn. */}
        <div className="mt-auto flex items-center gap-1.5 pt-2.5">
          <Link
            href={`/shop/${product.slug}`}
            className={cn(
              'min-w-0 flex-1 truncate rounded-(--radius-input) px-3 py-2.5 text-center text-[0.8125rem] font-semibold transition-colors',
              product.can_promote
                ? 'bg-brand-600 text-white hover:bg-brand-500'
                : 'border border-ink-300 text-ink-700 hover:border-brand-600/50 hover:text-brand-700',
            )}
          >
            {product.can_promote ? t('promote') : training ? t('view') : t('viewProduct')}
          </Link>

        {/* Share goes to the product page rather than copying here. A copied
              link has to carry the affiliate code, and a card that silently
              copies something is a card that can silently copy the wrong thing.
              The promote panel shows the link before it is shared.

              Visible from 380px, as in the reference, and not below it. Two
              cards across a 320px screen leaves 114px inside a card; "Promote"
              plus its padding is 84 of that, so a 36px square beside it forced
              the button to clip its own label. The reference is photographed on
              a 430px phone, where the pair fits with room to spare. */}
          <Link
            href={`/shop/${product.slug}#promote`}
            aria-label={t('shareLabel', { title: product.title })}
            className="hidden size-9 shrink-0 place-items-center rounded-(--radius-input) border border-ink-200 text-ink-600 transition-colors hover:border-brand-600/50 hover:text-brand-700 min-[380px]:grid"
          >
            {product.can_promote ? (
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
