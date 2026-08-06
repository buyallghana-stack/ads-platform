'use client'

import { useState, useTransition } from 'react'
import {
  BadgeCheck,
  FileText,
  GraduationCap,
  HelpCircle,
  Lock,
  PlayCircle,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

import { OfferPanel, PanelAction } from '@/components/market/OfferPanel'
import { PromotePanel, type PromoteInfo } from '@/components/market/PromotePanel'
import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import type { ShopDetail } from '@/lib/market/data'
import { buyProductAction } from '@/app/[locale]/shop/actions'

const KIND_ICON: Record<string, LucideIcon> = {
  video: PlayCircle,
  article: ScrollText,
  pdf: FileText,
  quiz: HelpCircle,
}

const KIND_LABEL: Record<string, string> = {
  video: 'Video',
  article: 'Article',
  pdf: 'Reading',
  quiz: 'Quiz',
}

/**
 * The product page.
 *
 * ---------------------------------------------------------------------------
 * TWO PANELS, NOT TWO BUTTONS
 *
 * The instruction was "affiliates should be shown two buttons, promote,
 * purchase". Two buttons side by side is the literal reading and the wrong
 * shape: it asks "which of these do you want", but they are not alternatives.
 * They are two different relationships with the same product — one is spending
 * money, the other is earning it — and a person arrives already knowing which
 * they are.
 *
 * So each gets its own bordered offer panel, stacked. Stacking also makes room
 * for the thing two buttons cannot show: an affiliate who CANNOT yet promote
 * this product needs to know which of four reasons applies, and there is
 * nowhere to put that under a button.
 *
 * ORDER: promote first for an active affiliate, buy first for everybody else.
 * An affiliate opening a product page is far more often deciding what to share
 * than what to buy.
 *
 * ---------------------------------------------------------------------------
 * THE CURRICULUM IS THE PITCH
 *
 * For a course the honest answer to "what am I buying" is the list of lessons —
 * titles and durations, which is all `shop_product` returns. Somebody deciding
 * whether to buy is entitled to see the SHAPE of what they would get; they are
 * not entitled to the contents.
 *
 * There is deliberately no earnings claim anywhere: no projection, no average,
 * no example. The promote panel states what THIS product pays on ONE sale, and
 * nothing about how many sales anybody makes.
 */
export function ProductDetail({
  detail,
  signedIn,
  promote,
  origin,
}: {
  detail: Extract<ShopDetail, { ok: true }>
  signedIn: boolean
  promote: PromoteInfo | null
  origin: string
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { product, training, sections } = detail

  const lessons = sections.reduce((n, s) => n + s.lessons.length, 0)

  function buy() {
    /*
      A signed-out visitor is the normal case here — this page is what an
      affiliate link points at, and those go to strangers.

      No `?next=` is passed: nothing honours one, and signup routes through
      email verification, so carrying an intent across it needs a cookie
      consumed at the landing step. Passing it would look like a promise to come
      back and quietly drop them on the dashboard. The panel footnote says what
      IS true — the click is remembered for thirty days.
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

  const promoteFirst = Boolean(promote?.canPromote)

  const buyPanel = product.owned ? (
    <OfferPanel
      label="Your library"
      headline={
        <span className="inline-flex items-center gap-2 text-jade-700">
          <BadgeCheck aria-hidden className="size-6" />
          <span className="text-[1.375rem]">You own this</span>
        </span>
      }
    >
      <PanelAction href={`/learn/${product.slug}`}>Open it</PanelAction>
    </OfferPanel>
  ) : (
    <OfferPanel
      label={product.purpose === 'training_program' ? 'Buy the course' : 'Buy this'}
      headline={
        <>
          {product.priceMinor === 0 ? 'Free' : cedis(product.priceMinor)}
          {product.onSale && (
            <span className="ml-2 text-[1rem] font-medium text-ink-400 line-through">
              {cedis(product.listPriceMinor)}
            </span>
          )}
        </>
      }
      benefits={
        training
          ? [
              <span key="levels">
                Commission on{' '}
                <strong className="font-semibold">
                  {training.commissionDepth} level{training.commissionDepth === 1 ? '' : 's'}
                </strong>{' '}
                for a year
              </span>,
              <span key="keep">The course stays yours after that year ends</span>,
              <span key="unlock">
                Promoting unlocks at {training.activationThreshold}% through the course
              </span>,
              ...(training.certificate
                ? [<span key="cert">A certificate when you finish it</span>]
                : []),
            ]
          : [
              <span key="keep">Yours to keep, with no subscription</span>,
              <span key="read">Read in the app on any device</span>,
            ]
      }
      footnote={
        signedIn
          ? 'Paid once. Refundable within 14 days.'
          : 'Create an account first, then come back here to buy. Paid once, refundable within 14 days.'
      }
    >
      <PanelAction onClick={buy} disabled={pending}>
        {pending ? 'Taking you to payment…' : signedIn ? 'Buy now' : 'Sign up to buy'}
      </PanelAction>
      {error && (
        <p role="alert" className="mt-2.5 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}
    </OfferPanel>
  )

  const promotePanel = promote ? (
    <PromotePanel info={promote} productSlug={product.slug} origin={origin} />
  ) : null

  const panels = promoteFirst ? (
    <>
      {promotePanel}
      {buyPanel}
    </>
  ) : (
    <>
      {buyPanel}
      {promotePanel}
    </>
  )

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
      <div className="min-w-0">
        {/* Cover. No product carries an image yet, so the placeholder is a
            designed state rather than a grey box — it is what every product
            looks like until covers exist. */}
        <div className="grid aspect-[16/8] place-items-center rounded-(--radius-panel) bg-gradient-to-br from-jade-50 via-surface to-ink-50">
          <GraduationCap aria-hidden className="size-12 text-jade-600/50" strokeWidth={1.25} />
        </div>

        <h1 className="mt-5 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.03em] text-ink-900">
          {product.title}
        </h1>

        {product.description && (
          <p className="mt-2.5 max-w-prose text-[1rem] leading-relaxed text-ink-700">
            {product.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-600">
          {lessons > 0 && <span>{lessons} lessons</span>}
          {training && (
            <>
              <span aria-hidden>·</span>
              <span className="capitalize">{training.level}</span>
            </>
          )}
          {product.minAffiliateTier === 'professional' && (
            <>
              <span aria-hidden>·</span>
              <span>Professional affiliates only</span>
            </>
          )}
        </div>

        {/* PHONE + TABLET: the panels sit here, under the summary and above the
            curriculum — the decision comes before the detail. At lg they move
            to the sticky right column instead (reference 0578). */}
        <div className="mt-5 space-y-3 lg:hidden">{panels}</div>

        {sections.length > 0 && (
          <section className="mt-7">
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
              What is inside
            </h2>
            <div className="mt-3 space-y-2.5">
              {sections.map((section, si) => (
                <div
                  key={si}
                  className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface"
                >
                  <p className="px-4 py-3 text-[0.875rem] font-semibold text-ink-900">
                    <span className="mr-2 tabular-nums text-ink-400">
                      {String(si + 1).padStart(2, '0')}
                    </span>
                    {section.title}
                  </p>
                  <ul className="border-t border-ink-200">
                    {section.lessons.map((lesson, li) => {
                      const Icon = KIND_ICON[lesson.kind] ?? PlayCircle
                      return (
                        <li key={li} className="flex items-center gap-3 px-4 py-3">
                          {/* Icon in a rounded square — the row anatomy every
                              reference uses, and far easier to scan than a
                              bare glyph on its own. */}
                          <span
                            aria-hidden
                            className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-50 text-ink-500"
                          >
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.9375rem] text-ink-900">
                              {lesson.title}
                            </span>
                            <span className="block text-[0.75rem] text-ink-500">
                              {KIND_LABEL[lesson.kind] ?? 'Lesson'}
                              {lesson.seconds ? ` · ${Math.round(lesson.seconds / 60)} min` : ''}
                            </span>
                          </span>
                          {lesson.preview ? (
                            <Link
                              href={`/learn/${product.slug}`}
                              className="shrink-0 rounded-full border border-jade-600/40 px-2.5 py-1 text-[0.75rem] font-semibold text-jade-700"
                            >
                              Preview
                            </Link>
                          ) : (
                            <Lock
                              aria-label="Included when you buy"
                              className="size-4 shrink-0 text-ink-300"
                            />
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

      {/* DESKTOP: the commercial column, sticky beside a long curriculum. */}
      <aside className="hidden lg:sticky lg:top-6 lg:block lg:space-y-3">{panels}</aside>
    </div>
  )
}
