'use client'

import { useState, useTransition } from 'react'
import {
  BadgeCheck,
  CalendarClock,
  Check,
  FileText,
  HelpCircle,
  Layers,
  Lock,
  PlayCircle,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import { cedis } from '@/lib/market/money'
import type { ShopDetail } from '@/lib/market/data'
import { buyProductAction } from '@/app/[locale]/shop/actions'

const KIND_ICON: Record<string, LucideIcon> = {
  video: PlayCircle,
  article: ScrollText,
  pdf: FileText,
  quiz: HelpCircle,
}

/**
 * The product page.
 *
 * ---------------------------------------------------------------------------
 * THE CURRICULUM IS THE SALES PITCH
 *
 * For a course, the honest answer to "what am I buying" is the list of lessons.
 * So the outline is the body of the page rather than a tab behind it — titles
 * and durations, which is what `shop_product` returns, and deliberately nothing
 * else. Somebody deciding whether to buy is entitled to see the SHAPE of what
 * they would get; they are not entitled to the contents.
 *
 * Preview lessons are marked and linked. Everything else shows a lock — the
 * same treatment as the curriculum rail inside the player, so the two screens
 * do not disagree about what is open.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TRAINING PRODUCT ADDS
 *
 * Buying training is not buying a course, it is buying the right to promote for
 * a year. The three facts that actually differ between Beginner and
 * Professional — how many commission levels, how long it lasts, what renewal
 * costs — are stated plainly, because the price alone does not tell you and
 * guessing wrong is expensive.
 *
 * There is deliberately NO earnings figure anywhere on this page. Not a
 * projection, not an average, not an example. That is the line between a
 * product page and an income claim.
 */
export function ProductDetail({
  detail,
  signedIn,
}: {
  detail: Extract<ShopDetail, { ok: true }>
  signedIn: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { product, training, sections } = detail

  const lessons = sections.reduce((n, s) => n + s.lessons.length, 0)
  const minutes = Math.round(
    sections.reduce((n, s) => n + s.lessons.reduce((m, l) => m + (l.seconds ?? 0), 0), 0) / 60,
  )

  function buy() {
    /*
      A signed-out visitor is the NORMAL case here — this page is what an
      affiliate link points at, and those go to strangers. So the button does
      not refuse, it sends them to sign up.

      ⚠️ It does NOT pass a `next` parameter, because nothing honours one:
      signup routes through email verification, and carrying an intent across
      that needs a cookie consumed at the landing step. Sending `?next=` would
      look like a promise to come back here and silently drop them on the
      dashboard instead.

      What IS true is said below the button: the visitor cookie was minted by
      middleware on the way in and lasts thirty days, so whenever they do
      return and buy, the affiliate who sent them is still paid.
    */
    if (!signedIn) {
      window.location.href = '/signup'
      return
    }

    setError(null)
    start(async () => {
      const result = await buyProductAction(product.id)
      if (!result.ok) return setError(result.message)
      // A full navigation, not a router push: this leaves the app for Paystack.
      window.location.href = result.redirectTo
    })
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
      <div className="min-w-0">
        <div className="grid aspect-[16/7] place-items-center rounded-(--radius-card) bg-gradient-to-br from-jade-50 to-brand-50">
          <Layers aria-hidden className="size-10 text-jade-600/60" strokeWidth={1.5} />
        </div>

        <h1 className="mt-5 text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink-900">
          {product.title}
        </h1>

        {product.description && (
          <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-700">
            {product.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-600">
          {lessons > 0 && (
            <span>
              {lessons} lesson{lessons === 1 ? '' : 's'}
            </span>
          )}
          {minutes > 0 && <span>· about {minutes} min</span>}
          {product.minAffiliateTier === 'professional' && (
            <Badge tone="neutral">Professional affiliates only</Badge>
          )}
        </div>

        {training && (
          <div className="mt-5 rounded-(--radius-card) border border-jade-600/25 bg-jade-50 p-4">
            <p className="text-[0.8125rem] font-semibold text-jade-700">
              What this gives you
            </p>
            <ul className="mt-2 space-y-1.5">
              <Fact>
                Commission on {training.commissionDepth} level
                {training.commissionDepth === 1 ? '' : 's'}
              </Fact>
              <Fact>
                The right to promote for {Math.round(training.validityDays / 365)} year, from the
                day you buy
              </Fact>
              <Fact>The course stays yours after that year ends</Fact>
              <Fact>
                Promoting unlocks once you are {training.activationThreshold}% through the course
              </Fact>
              {training.certificate && <Fact>A certificate when you finish it</Fact>}
              {training.renewalPriceMinor !== null && (
                <Fact>
                  Renewing after a year costs {cedis(training.renewalPriceMinor)}
                </Fact>
              )}
            </ul>
          </div>
        )}

        {sections.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[0.9375rem] font-semibold text-ink-900">What is inside</h2>
            <div className="mt-2 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
              {sections.map((section, si) => (
                <div key={si}>
                  <p className="border-y border-ink-200 bg-ink-50 px-4 py-2 text-[0.8125rem] font-semibold text-ink-700 first:border-t-0">
                    {section.title}
                  </p>
                  <ul className="divide-y divide-ink-200">
                    {section.lessons.map((lesson, li) => {
                      const Icon = KIND_ICON[lesson.kind] ?? PlayCircle
                      return (
                        <li
                          key={li}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-[0.875rem]"
                        >
                          <Icon aria-hidden className="size-4 shrink-0 text-ink-400" />
                          <span className="min-w-0 flex-1 truncate text-ink-800">
                            {lesson.title}
                          </span>
                          {lesson.preview ? (
                            <Link
                              href={`/learn/${product.slug}`}
                              className="shrink-0 text-[0.75rem] font-semibold text-jade-700 hover:underline"
                            >
                              Preview
                            </Link>
                          ) : (
                            <Lock aria-label="Included when you buy" className="size-3.5 shrink-0 text-ink-300" />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* The buy panel. Sticky from lg so it stays reachable while somebody
          reads a long curriculum — the one control on the page. */}
      <aside className="mt-6 lg:sticky lg:top-6 lg:mt-0">
        <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4">
          <div className="flex items-baseline gap-2">
            {product.onSale && (
              <span className="text-[0.9375rem] text-ink-400 line-through">
                {cedis(product.listPriceMinor)}
              </span>
            )}
            <span className="text-[1.75rem] leading-none font-semibold tabular-nums tracking-[-0.02em] text-ink-900">
              {product.priceMinor === 0 ? 'Free' : cedis(product.priceMinor)}
            </span>
          </div>

          {product.owned ? (
            <>
              <p className="mt-3 flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-700">
                <BadgeCheck aria-hidden className="size-4" />
                You own this
              </p>
              <Link
                href={`/learn/${product.slug}`}
                className="mt-3 flex w-full items-center justify-center rounded-(--radius-input) bg-jade-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-jade-700"
              >
                Open it
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={buy}
                disabled={pending}
                className={cn(
                  'mt-4 w-full rounded-(--radius-input) bg-jade-600 px-4 py-3',
                  'text-sm font-semibold text-white transition-colors hover:bg-jade-700',
                  'disabled:opacity-60',
                )}
              >
                {pending ? 'Taking you to payment…' : signedIn ? 'Buy now' : 'Sign up to buy'}
              </button>
              <p className="mt-2 flex items-start gap-1.5 text-[0.75rem] leading-snug text-ink-500">
                <CalendarClock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {signedIn
                  ? 'Paid once. Refundable within 14 days.'
                  : 'Create an account first, then come back here to buy. Paid once, refundable within 14 days.'}
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger-600">
              {error}
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-[0.8125rem] leading-snug text-ink-700">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-jade-600" />
      {children}
    </li>
  )
}
