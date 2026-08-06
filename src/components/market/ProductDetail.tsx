'use client'

import { useState, useTransition } from 'react'
import {
  Award,
  BadgeCheck,
  Check,
  Clock,
  FileText,
  GraduationCap,
  HelpCircle,
  Layers,
  Lock,
  RefreshCw,
  PlayCircle,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

import Image from 'next/image'

import { OfferPanel, PanelAction } from '@/components/market/OfferPanel'
import { PromotePanel, type PromoteInfo } from '@/components/market/PromotePanel'
import { Link } from '@/i18n/navigation'
import { courseLength, coverUrl } from '@/lib/market/covers'
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
  const cover = coverUrl(product.coverPath)
  const length = courseLength(product.seconds)

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
        {/* The cover. A real image, from the public bucket — `cover_path` had
            existed since migration 107 and nothing ever wrote to it, which is
            why this used to be a gradient with an excuse. */}
        <div className="relative aspect-[16/8] overflow-hidden rounded-(--radius-panel) bg-ink-100">
          {cover ? (
            <Image
              src={cover}
              alt=""
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 640px"
              className="object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center">
              <GraduationCap aria-hidden className="size-12 text-ink-400" strokeWidth={1.25} />
            </span>
          )}
          {product.category && (
            <span className="absolute left-4 top-4 rounded-full bg-surface/95 px-3 py-1.5 text-[0.75rem] font-semibold text-ink-800 backdrop-blur-sm">
              {product.category}
            </span>
          )}
        </div>

        <h1 className="mt-5 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.03em] text-ink-900">
          {product.title}
        </h1>

        {product.description && (
          <p className="mt-2.5 max-w-prose text-[1rem] leading-relaxed text-ink-700">
            {product.description}
          </p>
        )}

        {product.vendorName && (
          <p className="mt-2 text-[0.875rem] font-medium text-ink-700">{product.vendorName}</p>
        )}

        {/* The detail strip. Reference 0578 gives these their own labelled list
            because they are the facts somebody scans before reading a word of
            the description. All derived — nothing here is stored twice. */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {length && <Detail Icon={Clock} label="Length" value={length} />}
          {lessons > 0 && <Detail Icon={Layers} label="Lessons" value={String(lessons)} />}
          {product.quizzes > 0 && (
            <Detail Icon={HelpCircle} label="Quizzes" value={String(product.quizzes)} />
          )}
          {training && (
            <Detail
              Icon={RefreshCw}
              label="Access"
              value={`${Math.round(training.validityDays / 365)} year`}
            />
          )}
        </div>

        {/* PHONE + TABLET: the panels sit here, under the summary and above the
            curriculum — the decision comes before the detail. At lg they move
            to the sticky right column instead (reference 0578). */}
        <div className="mt-5 space-y-3 lg:hidden">{panels}</div>

        {product.outcomes.length > 0 && (
          <section className="mt-7">
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
              What you will learn
            </h2>
            {/* Two columns from sm, exactly as the reference lays it out — a
                single column of eight checkmarks reads as a wall. */}
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {product.outcomes.map((outcome, i) => (
                <li key={i} className="flex gap-2.5 text-[0.9375rem] leading-snug text-ink-800">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-jade-600" strokeWidth={2.5} />
                  {outcome}
                </li>
              ))}
            </ul>
          </section>
        )}

        {training?.certificate && (
          <section className="mt-7 flex items-center gap-4 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-full bg-jade-50 text-jade-700"
            >
              <Award className="size-6" strokeWidth={1.5} />
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold text-ink-900">Earn your certificate</p>
              <p className="mt-0.5 text-[0.875rem] leading-snug text-ink-600">
                Finish every lesson and the certificate is issued to your account. Promoting
                unlocks earlier, at {training.activationThreshold}%.
              </p>
            </div>
          </section>
        )}

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

/** One fact in the detail strip. Icon in a rounded square, per the references —
 *  a bare number with a word under it reads as a stat block; this reads as a
 *  specification. */
function Detail({
  Icon,
  label,
  value,
}: {
  Icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2.5">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-50 text-ink-500">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.6875rem] text-ink-500">{label}</span>
        <span className="block truncate text-[0.875rem] font-semibold text-ink-900">{value}</span>
      </span>
    </div>
  )
}
