'use client'

import { useMemo, useState } from 'react'
import { Bell, ChevronRight, Search, SlidersHorizontal, Store } from 'lucide-react'

import { CourseCard } from '@/components/market/CourseCard'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { ShopProduct } from '@/lib/market/data'

/**
 * The shop, built to reference 0572 screen 1.
 *
 * ---------------------------------------------------------------------------
 * A GREETING, NOT A PAGE TITLE
 *
 * This screen used to open with "Shop / Courses and ebooks. Buy once, and they
 * stay yours." The operator's verdict was that it read as boring and
 * unprofessional, and the reference explains why: it opens with
 *
 *     Welcome,
 *     Maria Waelchi                                    🔔  (face)
 *
 * A page title tells you where you are, which you already know because you
 * tapped to get here. A greeting tells you the app knows who you are. It is the
 * difference between a filing cabinet and a shopfront, and it costs the same
 * number of pixels.
 *
 * ---------------------------------------------------------------------------
 * THE THREE-PART BROWSE
 *
 * The reference layers browsing rather than listing:
 *
 *   search        for people who know what they want
 *   chips         for people who know roughly
 *   carousel      for people who want to be shown something
 *   list          for everything else
 *
 * A single vertical list — which is what this was — only serves the last of
 * those four, which is why it felt like a spreadsheet.
 *
 * Filtering is client-side deliberately. The catalogue is tens of products by
 * design (A2: the Owner enlists each vendor by hand), so a round trip per
 * keystroke would add latency to a list that fits in memory several times over.
 */
export function ShopScreen({
  products,
  greetingName,
  platformName,
  labels,
}: {
  products: ShopProduct[]
  /** First name. Null when signed out — the greeting becomes a welcome. */
  greetingName: string | null
  platformName: string
  labels: {
    welcome: string
    browse: string
    searchPlaceholder: string
    all: string
    featured: string
    everything: string
    viewAll: string
    owned: string
    emptyTitle: string
    emptyBody: string
    noMatch: string
  }
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))] as string[],
    [products],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (category && p.category !== category) return false
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q) ||
        (p.instructor_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, query, category])

  /* The carousel leads with training, because that is the product this
     business needs somebody to buy first — everything else in the affiliate
     programme is downstream of it. */
  const featured = filtered.filter((p) => p.purpose === 'training_program')
  const rest = filtered.filter((p) => p.purpose !== 'training_program')

  return (
    <div className="pb-6">
      <header className="px-4 pt-5 sm:px-6 md:px-8">
        <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4">
          <div className="min-w-0">
            {/* A NAME is greeted; a stranger is not. Pretending to know
                somebody who has not signed in reads as a mail merge, so they
                get a headline instead — and it does not truncate, because a
                headline cut off mid-word is worse than one that wraps. */}
            {greetingName ? (
              <>
                <p className="text-[0.8125rem] text-ink-500">{labels.welcome}</p>
                <p className="mt-0.5 truncate text-[1.5rem] leading-tight font-semibold tracking-[-0.03em] text-ink-900">
                  {greetingName}
                </p>
              </>
            ) : (
              <p className="max-w-[16ch] text-[1.5rem] leading-[1.15] font-semibold tracking-[-0.03em] text-ink-900">
                {labels.browse}
              </p>
            )}
          </div>
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-ink-200 bg-surface text-ink-600 transition-colors hover:border-ink-300"
          >
            <Bell aria-hidden className="size-4.5" />
          </Link>
        </div>

        {/* Search + filter, as one row. The filter button is its own square in
            the reference rather than an icon inside the field — it opens a
            different thing, so it is a different control. */}
        <div className="mx-auto mt-4 flex w-full max-w-6xl items-center gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-ink-200 bg-surface px-4 py-3">
            <Search aria-hidden className="size-4 shrink-0 text-ink-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.searchPlaceholder}
              aria-label={labels.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink-900 outline-none placeholder:text-ink-400 pointer-coarse:text-base"
            />
          </div>
          <button
            type="button"
            aria-label="Filters"
            onClick={() => setCategory(null)}
            className="grid size-12 shrink-0 place-items-center rounded-full border border-ink-200 bg-surface text-ink-600 transition-colors hover:border-ink-300"
          >
            <SlidersHorizontal aria-hidden className="size-4.5" />
          </button>
        </div>

        {/* Chips. Scroll horizontally rather than wrapping — a wrapping chip
            row changes the page height as you filter, which moves the content
            you were about to tap. */}
        {categories.length > 0 && (
          <div className="mx-auto mt-3.5 w-full max-w-6xl">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Chip active={category === null} onClick={() => setCategory(null)}>
                {labels.all}
              </Chip>
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </header>

      {products.length === 0 ? (
        <div className="mx-auto mt-6 w-full max-w-6xl px-4 sm:px-6 md:px-8">
          <div className="rounded-(--radius-panel) border border-dashed border-ink-300 bg-surface px-4 py-14 text-center">
            <Store aria-hidden className="mx-auto size-7 text-ink-400" strokeWidth={1.5} />
            <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{labels.emptyTitle}</p>
            <p className="mx-auto mt-1 max-w-sm text-[0.875rem] leading-snug text-ink-600">
              {labels.emptyBody}
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mx-auto mt-8 w-full max-w-6xl px-4 text-center text-[0.875rem] text-ink-500 sm:px-6 md:px-8">
          {labels.noMatch}
        </p>
      ) : (
        <>
          {featured.length > 0 && (
            <section className="mt-6">
              <SectionHead title={labels.featured} />
              {/* Horizontal on a phone, a real grid from sm. The carousel is a
                  phone answer to a phone problem — at tablet width there is
                  room to show them all without asking anyone to swipe. */}
              {/* No negative margin. `-mx-4 px-4` put the first card flush
                  against the viewport edge while the section heading kept its
                  gutter, so the two disagreed by 16px. Plain padding on the
                  scroller keeps them aligned and still lets the last card
                  scroll past the edge, which is the whole effect. */}
              <div className="mx-auto w-full max-w-6xl">
                <div className="flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-6 lg:grid-cols-3 md:px-8 [&::-webkit-scrollbar]:hidden">
                  {featured.map((p) => (
                    <CourseCard
                      key={p.id}
                      product={p}
                      platformName={platformName}
                      savedLabel={labels.owned}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section className="mt-7">
              <SectionHead title={labels.everything} action={labels.viewAll} />
              <div className="mx-auto w-full max-w-6xl space-y-2.5 px-4 sm:px-6 md:px-8 lg:grid lg:grid-cols-2 lg:gap-2.5 lg:space-y-0">
                {rest.map((p) => (
                  <CourseCard
                    key={p.id}
                    product={p}
                    variant="row"
                    platformName={platformName}
                    savedLabel={labels.owned}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function SectionHead({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mx-auto mb-3 flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 md:px-8">
      <h2 className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-ink-900">{title}</h2>
      {action && (
        <span className="inline-flex items-center gap-0.5 text-[0.8125rem] font-semibold text-jade-700">
          {action}
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors',
        active
          ? 'border-jade-600 bg-jade-50 text-jade-700'
          : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300',
      )}
    >
      {children}
    </button>
  )
}
