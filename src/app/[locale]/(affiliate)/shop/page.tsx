import type { Metadata } from 'next'

import { ArrowRight, PackageOpen, Sparkles } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { MarketFilters } from '@/components/affiliate/MarketFilters'
import { ProductCard } from '@/components/affiliate/ProductCard'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateDashboard, getShopProducts, type ShopProduct } from '@/lib/market/data'

export const metadata: Metadata = {
  title: 'Products',
  robots: { index: false, follow: false },
}

const TABS = ['all', 'course', 'ebook', 'bundle', 'saved'] as const
const SORTS = ['payout', 'newest', 'priceUp', 'priceDown'] as const

/** Which tab a product belongs to. `saved` cuts across the kinds rather than
 *  being one of them, which is why this is a predicate and not a lookup. */
function inTab(p: ShopProduct, tab: string) {
  if (tab === 'all') return true
  if (tab === 'saved') return p.saved
  return p.kind === tab
}

/**
 * The affiliate marketplace — everything there is to promote.
 *
 * Filtering, searching and sorting all happen HERE, on the server, over the one
 * list `shop_products` returns. That is a deliberate choice and it is only
 * correct at this scale: the catalogue is the operator's own and is measured in
 * tens, so one read and an array operation beats a query per filter change, and
 * it keeps the counts on the tabs honest — they are computed from the same
 * array the grid is drawn from, so a tab can never claim a number the grid
 * then contradicts.
 *
 * ⚠️ If the catalogue ever reaches the hundreds this has to move into SQL with
 * pagination. The signal to watch for is the page weight, not the code: every
 * product ships its full description to the client on first paint.
 */
export default async function MarketplacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string; sort?: string; q?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.market')
  const sp = await searchParams

  const tab = TABS.includes(sp.tab as (typeof TABS)[number]) ? sp.tab! : 'all'
  const sort = SORTS.includes(sp.sort as (typeof SORTS)[number]) ? sp.sort! : 'payout'
  const query = (sp.q ?? '').trim()

  const [everything, dashboard] = await Promise.all([
    getShopProducts(user!.id),
    getAffiliateDashboard(user!.id),
  ])

  /*
    ANYTHING ALREADY BOUGHT IS OFF THIS SCREEN (operator, 2026-08-07).

    A course somebody owns has no business in a shop: the card had to grow a
    progress bar and a "Continue" button to say so, which made two cards in the
    same row two different things. Owned courses live on Learn, which is built
    for exactly that, and this screen goes back to being what it says it is.

    Filtered before the counts are taken, so a tab cannot promise four and then
    list three.
  */
  const products = everything.filter((p) => !p.owned)

  const counts = Object.fromEntries(
    TABS.map((key) => [key, products.filter((p) => inTab(p, key)).length]),
  )

  const needle = query.toLowerCase()
  const visible = products
    .filter((p) => inTab(p, tab))
    .filter(
      (p) =>
        !needle ||
        p.title.toLowerCase().includes(needle) ||
        (p.description ?? '').toLowerCase().includes(needle) ||
        (p.category ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      switch (sort) {
        /* Default. What an affiliate is here to compare — and it is the CASH,
           not the rate: 20% of GHS 400 beats 35% of GHS 100, and sorting by
           percentage would put the worse product first. */
        case 'payout':
          return (b.l1_earn_minor ?? -1) - (a.l1_earn_minor ?? -1)
        case 'priceUp':
          return a.price_minor - b.price_minor
        case 'priceDown':
          return b.price_minor - a.price_minor
        default:
          return 0
      }
    })

  const joined = dashboard.state !== 'none'

  return (
    <div className="relative isolate mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 max-w-xl text-[0.8125rem] leading-snug text-ink-500">
          {t('subtitle')}
        </p>
      </div>

      {/* The banner only appears to somebody who cannot promote yet. Shown to
          an active affiliate it is an advertisement for a thing they have
          already bought, sitting permanently above the work. */}
      {!joined && (
        <Link
          href="/market"
          className="flex items-center gap-3 rounded-(--radius-panel) border border-brand-600/30 bg-brand-50 px-4 py-3.5 transition-colors hover:border-brand-600/60"
        >
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-(--radius-card) bg-brand-600/15 text-brand-700"
          >
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.875rem] font-semibold text-ink-900">
              {t('joinTitle')}
            </span>
            <span className="mt-0.5 block text-[0.8125rem] leading-snug text-ink-600">
              {t('joinBody')}
            </span>
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0 text-brand-700" />
        </Link>
      )}

      <MarketFilters tab={tab} sort={sort} query={query} counts={counts} />

      {visible.length === 0 ? (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface px-6 py-14 text-center">
          <span
            aria-hidden
            className="mx-auto grid size-12 place-items-center rounded-full bg-ink-100 text-ink-400"
          >
            <PackageOpen className="size-6" />
          </span>
          <p className="mt-3 text-[0.875rem] font-medium text-ink-900">
            {query ? t('emptySearch') : tab === 'saved' ? t('emptySaved') : t('emptyAll')}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
            {query ? t('emptySearchHint') : tab === 'saved' ? t('emptySavedHint') : t('emptyAllHint')}
          </p>
        </div>
      ) : (
        /* TWO ACROSS ON A PHONE (operator, 2026-08-06), which is what the
           reference shows and what a browsing grid wants: one card per row
           makes the screen a list you scroll rather than a shelf you scan, and
           at 390px a full-width card is mostly empty to the right of its own
           text.

           `minmax(0,1fr)` via `grid-cols-2` rather than an implicit column —
           an auto column is floored at its content's min-content width and a
           long product title would push the grid wider than the phone. Same
           trap as the course page. */
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
