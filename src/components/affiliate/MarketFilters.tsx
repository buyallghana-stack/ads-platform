'use client'

import { Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Tabs, search and sort for the marketplace.
 *
 * ── THE TABS ARE OUR KINDS, NOT THE REFERENCE'S ──
 *
 * The reference offers All / Trending / Digital / Physical / Services. Three of
 * those describe a catalogue we do not have — everything here is digital, there
 * is nothing to ship, and "trending" needs a popularity signal that does not
 * exist yet. Tabs that all return the same grid are worse than no tabs: they
 * teach the reader that the controls on this screen do nothing.
 *
 * So the tabs are `product_kind`, which is a real column with real values:
 * courses, e-books, bundles. Plus Saved, which is the one filter an affiliate
 * building a shortlist actually reaches for, and which the reference's heart
 * icon implies but never gives anywhere to go.
 *
 * ── STATE LIVES IN THE URL ──
 *
 * Same reason as the dashboard's period picker: a filtered grid is a page worth
 * sharing and worth having a back button for, and the filtering itself happens
 * on the server so there is only ever one version of the list.
 *
 * Search is the exception — it is debounced and pushed, because a round trip
 * per keystroke on Ghanaian mobile data is not a search box, it is a stutter.
 */

const TABS = ['all', 'course', 'ebook', 'bundle', 'saved'] as const
const SORTS = ['payout', 'newest', 'priceUp', 'priceDown'] as const

export function MarketFilters({
  tab,
  sort,
  query,
  counts,
}: {
  tab: string
  sort: string
  query: string
  /** Per-tab result counts, so a tab that would come back empty says so before
   *  it is tapped rather than after. */
  counts: Record<string, number>
}) {
  const t = useTranslations('affiliate.market')
  const pathname = usePathname()
  const router = useRouter()
  const [text, setText] = useState(query)
  const first = useRef(true)

  /* Debounced push. `replace` rather than `push` so typing eight characters
     does not put eight entries in the back stack. */
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => {
      const params = new URLSearchParams()
      if (tab !== 'all') params.set('tab', tab)
      if (sort !== 'payout') params.set('sort', sort)
      if (text.trim()) params.set('q', text.trim())
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : pathname, { scroll: false })
    }, 350)
    return () => clearTimeout(id)
  }, [text, tab, sort, pathname, router])

  const hrefFor = (next: Partial<{ tab: string; sort: string }>) => {
    const params = new URLSearchParams()
    const nt = next.tab ?? tab
    const ns = next.sort ?? sort
    if (nt !== 'all') params.set('tab', nt)
    if (ns !== 'payout') params.set('sort', ns)
    if (query) params.set('q', query)
    return { pathname, query: Object.fromEntries(params) }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs. Horizontally scrollable on a phone rather than wrapped to two
          rows — a second row of tabs pushes the first product below the fold,
          and five short words scroll comfortably in one. */}
      <div
        role="tablist"
        aria-label={t('filterLabel')}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((key) => {
          const active = key === tab
          return (
            <Link
              key={key}
              href={hrefFor({ tab: key })}
              role="tab"
              aria-selected={active}
              scroll={false}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-2 text-[0.8125rem] font-medium transition-colors',
                active
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300 hover:text-ink-900',
              )}
            >
              {t(`tab.${key}`)}
              {counts[key] !== undefined && (
                <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/70' : 'text-ink-400')}>
                  {counts[key]}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className={cn(
              'w-full rounded-(--radius-input) border border-ink-200 bg-surface py-2.5 pl-9 pr-9',
              'text-[0.875rem] text-ink-900 placeholder:text-ink-400',
              'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25',
              'pointer-coarse:text-base',
            )}
          />
          {text && (
            <button
              type="button"
              onClick={() => setText('')}
              aria-label={t('clearSearch')}
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-900"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>

        {/* A real <select>: four options, one tap, and the platform's own
            picker on a phone. `color-scheme: dark` on the skin wrapper is what
            makes the native menu render dark to match. */}
        <label className="flex items-center gap-2 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 sm:w-52">
          <span className="shrink-0 text-[0.75rem] text-ink-500">{t('sortLabel')}</span>
          <select
            value={sort}
            onChange={(e) => router.replace(
              (() => {
                const h = hrefFor({ sort: e.target.value })
                const qs = new URLSearchParams(h.query as Record<string, string>).toString()
                return qs ? `?${qs}` : pathname
              })(),
              { scroll: false },
            )}
            className="w-full cursor-pointer bg-transparent text-[0.8125rem] font-medium text-ink-900 focus:outline-none pointer-coarse:text-base"
          >
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {t(`sort.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
