import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { ArrowLeft, Award, BookOpen, CheckCircle2, Clock, FileText, Layers, PlayCircle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PromotePanel } from '@/components/affiliate/PromotePanel'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { courseLength, coverUrl } from '@/lib/market/covers'
import { getPromoteInfo, getShopProduct } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { getOrigin } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Product',
  robots: { index: false, follow: false },
}

const LESSON_ICON: Record<string, typeof PlayCircle> = {
  video: PlayCircle,
  article: FileText,
  pdf: FileText,
  quiz: CheckCircle2,
}

/**
 * A product, seen by somebody who might promote it or buy it.
 *
 * ── TWO AUDIENCES, TWO ACTIONS, ONE PAGE ──
 *
 * The operator's instruction (2026-08-06): an affiliate gets both Promote and
 * Purchase. They are genuinely different intents — one shares a link, one
 * spends money — and both are legitimate here, because the training programme
 * is a product an affiliate both promotes AND has to own.
 *
 * They are NOT two buttons side by side, which is how that instruction is most
 * easily mis-built. Two equally weighted buttons make the reader choose before
 * they have read anything, and the two are not comparable choices — Purchase is
 * a one-time decision about this product, Promote is a permanent capability
 * they either have or do not. So Purchase is the sticky primary action on the
 * offer, and Promote is its own panel with its own figures, reachable from
 * every card in the marketplace by anchor.
 *
 * ── THE LINK POINTS AT THE PUBLIC PAGE, NOT THIS ONE ──
 *
 * This route is inside the authenticated affiliate shell. A shared link has to
 * land a signed-out stranger somewhere they can read and buy, so it points at
 * `/p/[slug]`, which is public and carries the `ref` code that records the
 * click. Pointing it here would send every prospect to a login wall.
 */
export default async function AffiliateProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.product')

  const [detail, origin] = await Promise.all([
    getShopProduct(slug, user!.id),
    getOrigin(),
  ])

  if (!detail.ok) notFound()
  const { product, training, sections } = detail

  const promote = await getPromoteInfo(user!.id, product.id)
  const cover = coverUrl(product.coverPath)
  const length = courseLength(product.seconds)

  /* The affiliate's own link. Built from the code the RPC returned rather than
     from anything the browser holds — a link assembled client-side is a link
     that can lose its code and pay nobody, silently. */
  const shareUrl =
    promote?.code
      ? `${origin}/${locale}/p/${product.slug}?ref=${promote.code}`
      : `${origin}/${locale}/p/${product.slug}`

  return (
    <div className="relative isolate mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <Link
        href="/shop"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      {/* ── the product ──────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
        {cover && (
          <div className="aspect-[21/9] w-full overflow-hidden bg-ink-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" className="size-full object-cover" />
          </div>
        )}

        <div className="p-5 sm:p-6">
          {product.category && (
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-brand-700">
              {product.category}
            </p>
          )}
          <h1 className="mt-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-ink-900 sm:text-[1.75rem]">
            {product.title}
          </h1>
          {product.description && (
            <p className="mt-2.5 max-w-2xl text-[0.875rem] leading-relaxed text-ink-600">
              {product.description}
            </p>
          )}

          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem] text-ink-500">
            <li className="flex items-center gap-1.5">
              <BookOpen aria-hidden className="size-4" />
              {t('lessons', { n: product.lessons })}
            </li>
            {product.quizzes > 0 && (
              <li className="flex items-center gap-1.5">
                <CheckCircle2 aria-hidden className="size-4" />
                {t('checkpoints', { n: product.quizzes })}
              </li>
            )}
            {length && (
              <li className="flex items-center gap-1.5">
                <Clock aria-hidden className="size-4" />
                {length}
              </li>
            )}
            {training?.certificate && (
              <li className="flex items-center gap-1.5">
                <Award aria-hidden className="size-4" />
                {t('certificate')}
              </li>
            )}
            {training && training.commissionDepth >= 2 && (
              <li className="flex items-center gap-1.5 text-brand-700">
                <Layers aria-hidden className="size-4" />
                {t('twoLevels')}
              </li>
            )}
          </ul>

          {/* ── owning it ────────────────────────────────────────────── */}
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ink-200 pt-5">
            {product.owned ? (
              <>
                <Link
                  href={`/learn/${product.slug}`}
                  className="rounded-(--radius-input) bg-brand-600 px-5 py-3 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
                >
                  {product.percent > 0 ? t('continue') : t('start')}
                </Link>
                <p className="text-[0.8125rem] tabular-nums text-ink-500">
                  {t('ownedPercent', { n: product.percent })}
                </p>
              </>
            ) : (
              <>
                <Link
                  href={`/p/${product.slug}`}
                  className="rounded-(--radius-input) bg-brand-600 px-5 py-3 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
                >
                  {t('buy', { amount: cedis(product.priceMinor) })}
                </Link>
                {product.onSale && (
                  <p className="text-[0.8125rem] text-ink-500">
                    <span className="line-through">{cedis(product.listPriceMinor)}</span>{' '}
                    <span className="font-semibold text-success-600">{t('onSale')}</span>
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── promoting it ─────────────────────────────────────────────── */}
      {promote?.ok && <PromotePanel info={promote} url={shareUrl} />}

      {/* ── what is inside ───────────────────────────────────────────── */}
      {product.outcomes.length > 0 && (
        <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('outcomes')}</h2>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {product.outcomes.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[0.8125rem] text-ink-700">
                <CheckCircle2
                  aria-hidden
                  className="mt-px size-4 shrink-0 text-success-600"
                />
                <span className="leading-snug">{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('curriculum')}</h2>
          <div className="mt-3 flex flex-col gap-4">
            {sections.map((section, index) => (
              <div key={section.position}>
                {/* Numbered from the ARRAY, not from `position`. `position` is
                    a 0-based sort key the admin editor uses to order sections;
                    printing it produced "Section 0". The list is already
                    ordered by it, so the index is both correct and 1-based. */}
                <p className="text-[0.8125rem] font-semibold text-ink-800">
                  {t('sectionNumber', { n: index + 1 })} — {section.title}
                </p>
                <ul className="mt-2 flex flex-col divide-y divide-ink-200 border-y border-ink-200">
                  {section.lessons.map((lesson, i) => {
                    const Icon = LESSON_ICON[lesson.kind] ?? FileText

                    /*
                      ⚠️ THERE ARE TWO PRODUCT PAGES AND THE FIRST FIX ONLY
                      REACHED ONE. `/p/[slug]` is the public one an affiliate
                      link points at; THIS is the one inside the app, reached
                      from Products, and it is the one somebody browsing
                      actually taps. Both drew the same inert "Free preview"
                      `<span>`, so fixing the public page left the in-app badge
                      doing nothing — which is exactly what the operator hit on
                      the demo product.

                      Same rule as the other page: only the preview row links,
                      and `lesson_for_learner` refuses everything else on its
                      own regardless of what is rendered here.
                    */
                    const row = (
                      <>
                        <Icon aria-hidden className="size-4 shrink-0 text-ink-400" />
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-800">
                          {lesson.title}
                        </span>
                        {lesson.preview && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-500/15 px-2 py-0.5 text-[0.6875rem] font-medium text-success-600">
                            <PlayCircle aria-hidden className="size-3" />
                            {t('watchPreview')}
                          </span>
                        )}
                        {lesson.seconds ? (
                          <span className="shrink-0 text-[0.75rem] tabular-nums text-ink-500">
                            {courseLength(lesson.seconds) ?? ''}
                          </span>
                        ) : null}
                      </>
                    )

                    return (
                      <li key={lesson.id ?? `${section.position}-${i}`}>
                        {lesson.preview ? (
                          <Link
                            href={{
                              pathname: `/learn/${product.slug}`,
                              query: { lesson: lesson.id },
                            }}
                            className="-mx-2 flex items-center gap-3 rounded-(--radius-input) px-2 py-2.5 transition-colors hover:bg-success-500/10"
                          >
                            {row}
                          </Link>
                        ) : (
                          <span className="flex items-center gap-3 py-2.5">{row}</span>
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
  )
}
