import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { Award, BookOpen, CheckCircle2, Clock, FileText, Layers, PlayCircle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { BuyButton } from '@/components/affiliate/BuyButton'
import { Link } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { recordClick } from '@/lib/market/attribution'
import { courseLength, coverUrl } from '@/lib/market/covers'
import { getShopProduct } from '@/lib/market/data'
import { createAdminClient } from '@/lib/supabase/admin'
import { cedis } from '@/lib/market/money'

const LESSON_ICON: Record<string, typeof PlayCircle> = {
  video: PlayCircle,
  article: FileText,
  pdf: FileText,
  quiz: CheckCircle2,
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const detail = await getShopProduct(slug)
  if (!detail.ok) return { title: 'Product' }
  return {
    title: detail.product.title,
    description: detail.product.description ?? undefined,
    /* Indexable, unlike every signed-in screen. This page is the destination of
       every affiliate link and the only Phase 2 page a stranger is meant to
       reach — hiding it from search would be hiding the shopfront. */
    openGraph: {
      title: detail.product.title,
      description: detail.product.description ?? undefined,
      images: coverUrl(detail.product.coverPath) ? [coverUrl(detail.product.coverPath)!] : [],
    },
  }
}

/**
 * The PUBLIC product page — where an affiliate link lands.
 *
 * ── WHY IT IS NOT `/shop/[slug]` ──
 *
 * `/shop` lives inside the affiliate shell, which is behind the auth gate and
 * wears the dark affiliate skin. Sending a prospect there means a login wall
 * and a workspace UI for somebody who has never heard of us. This page is
 * public, in the main brand's light skin, and reads as a product page rather
 * than as a tool.
 *
 * ── THE CLICK IS RECORDED HERE, AND IT IS THE WHOLE BUSINESS ──
 *
 * `recordClick` is what makes a later purchase pay somebody. If it does not
 * run, every sale still completes, every product is still delivered, and no
 * affiliate earns a pesewa — with no error raised anywhere, because nothing is
 * technically wrong. It is the quietest possible failure in Phase 2.
 *
 * ⚠️ The visitor token it binds to is minted in MIDDLEWARE, not here.
 * `cookies().set()` during a Server Component render is a silent no-op, so a
 * token written here would be recorded against a cookie the browser never
 * kept. That bug shipped once and paid nobody. See `lib/market/attribution.ts`.
 */
export default async function PublicProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  /* `coupon` joins `ref` and `subid`: an affiliate link and a discount link
     are both just query parameters on the same product page, and one link can
     carry both. */
  searchParams: Promise<{ ref?: string; subid?: string; coupon?: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations('affiliate.public')
  const sp = await searchParams

  const user = await getSessionUser()
  const detail = await getShopProduct(slug, user?.id)
  if (!detail.ok) notFound()
  const { product, training, sections } = detail

  /* Recorded AFTER the product is known — `affiliate_clicks.product_id` is NOT
     NULL, so there is nothing to attribute a click to until the slug resolves.
     Failures are swallowed inside: a bad `ref` must never cost a sale. */
  if (sp.ref) {
    await recordClick({
      code: sp.ref,
      productId: product.id,
      userId: user?.id ?? null,
      landingUrl: `/${locale}/p/${slug}`,
      subid: sp.subid ?? null,
    })
  }

  const cover = coverUrl(product.coverPath)
  const length = courseLength(product.seconds)

  /* ⚠️ IS THIS AN UPGRADE FOR THIS VIEWER? `start_product_order` charges the
     difference when somebody already holds a lower training (migration 186),
     so a page that keeps advertising the list price quotes a figure the till
     will not take. Same source as the charge: `training_upgrade_offer`. */
  const upgrade =
    user && product.purpose === 'training_program'
      ? await createAdminClient()
          .rpc('training_upgrade_offer', { p_user_id: user.id })
          .then((r) => {
            const offer = r.data as { product_id?: string; upgrade_minor?: number } | null
            return offer && offer.product_id === product.id && offer.upgrade_minor != null
              ? offer.upgrade_minor
              : null
          })
      : null

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-ink-200 bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          {/* ⚠️ SIGNED IN, THE LOGO GOES BACK INTO THE APP. This page is
              public, so its logo pointed at the marketing site — which threw a
              signed-in affiliate out of the product mid-purchase, and looked
              like being logged out (operator, 2026-08-12). */}
          <Link href={user ? '/market' : '/'}>
            <Logo variant="dark" />
          </Link>
          {!user && (
            <Link
              href="/login"
              className="rounded-(--radius-input) border border-ink-200 px-3.5 py-2 text-[0.8125rem] font-semibold text-ink-700 transition-colors hover:border-brand-600 hover:text-brand-700"
            >
              {t('signIn')}
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_20rem] lg:items-start lg:py-10">
        {/* `min-w-0`: a grid item's default `min-width: auto` will not shrink
            below its content, and the cover below carries a full-size photo —
            enough to push the whole page sideways on a phone. */}
        <div className="flex min-w-0 flex-col gap-5">
          {cover && (
            <div className="aspect-[21/9] overflow-hidden rounded-(--radius-panel) bg-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover} alt="" className="size-full object-cover" />
            </div>
          )}

          <div>
            {product.category && (
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-brand-600">
                {product.category}
              </p>
            )}
            <h1 className="mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-[-0.02em] text-ink-900 sm:text-[2rem]">
              {product.title}
            </h1>
            {product.description && (
              <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-600">
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
            </ul>
          </div>

          {product.outcomes.length > 0 && (
            <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5">
              <h2 className="text-[1rem] font-semibold text-ink-900">{t('outcomes')}</h2>
              <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {product.outcomes.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-[0.875rem] text-ink-700">
                    <CheckCircle2 aria-hidden className="mt-px size-4 shrink-0 text-success-600" />
                    <span className="leading-snug">{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sections.length > 0 && (
            <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5">
              <h2 className="text-[1rem] font-semibold text-ink-900">{t('curriculum')}</h2>
              <div className="mt-3 flex flex-col gap-4">
                {sections.map((section, index) => (
                  <div key={section.position}>
                    <p className="text-[0.8125rem] font-semibold text-ink-800">
                      {t('sectionNumber', { n: index + 1 })} — {section.title}
                    </p>
                    <ul className="mt-2 divide-y divide-ink-200 border-y border-ink-200">
                      {section.lessons.map((lesson, i) => {
                        const Icon = LESSON_ICON[lesson.kind] ?? FileText

                        /*
                          ⚠️ A FREE PREVIEW IS A LINK NOW. It was a `<span>`
                          saying "Free preview" beside a lesson nobody could
                          open — the badge advertised something the page had no
                          way to deliver, because `shop_product` returned a
                          lesson's title and not its id.

                          Only the preview row links. Everything else stays
                          exactly as inert as it was, and the server agrees
                          independently: `lesson_for_learner` allows
                          `is_preview or has_entitlement(...)` and refuses the
                          rest, so a hand-typed id for a paid lesson gets
                          nothing. The link is a convenience over a rule that
                          already existed, not the rule itself.
                        */
                        const row = (
                          <>
                            <Icon aria-hidden className="size-4 shrink-0 text-ink-400" />
                            <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-800">
                              {lesson.title}
                            </span>
                            {lesson.preview && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-[0.6875rem] font-medium text-success-700">
                                <PlayCircle aria-hidden className="size-3" />
                                {t('watchPreview')}
                              </span>
                            )}
                          </>
                        )

                        return (
                          <li key={lesson.id ?? i}>
                            {lesson.preview ? (
                              <Link
                                href={{
                                  pathname: `/learn/${product.slug}`,
                                  query: { lesson: lesson.id },
                                }}
                                className="-mx-2 flex items-center gap-3 rounded-(--radius-input) px-2 py-2.5 transition-colors hover:bg-success-50"
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

        {/* ── the offer ────────────────────────────────────────────────
            Sticky from lg up only. On a phone it sits after the summary and
            before the curriculum, because a sticky bar over a long scroll on a
            small screen eats the content it is trying to sell. */}
        <aside className="lg:sticky lg:top-6">
          <div className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5">
            <p className="flex items-baseline gap-2">
              <span className="text-[1.875rem] font-bold leading-none tabular-nums text-ink-900">
                {cedis(upgrade ?? product.priceMinor)}
              </span>
              {(upgrade !== null || product.onSale) && (
                <span className="text-[0.875rem] text-ink-400 line-through">
                  {cedis(upgrade !== null ? product.priceMinor : product.listPriceMinor)}
                </span>
              )}
            </p>
            {upgrade !== null && (
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
                {t('upgradePrice')}
              </p>
            )}

            {training && (
              <ul className="mt-4 flex flex-col gap-2.5 border-t border-ink-200 pt-4">
                <li className="flex items-start gap-2.5 text-[0.8125rem] text-ink-700">
                  <Layers aria-hidden className="mt-px size-4 shrink-0 text-brand-600" />
                  <span className="leading-snug">
                    {training.commissionDepth >= 2 ? t('twoLevels') : t('oneLevel')}
                  </span>
                </li>
                <li className="flex items-start gap-2.5 text-[0.8125rem] text-ink-700">
                  <Clock aria-hidden className="mt-px size-4 shrink-0 text-brand-600" />
                  <span className="leading-snug">
                    {t('validity', { n: training.validityDays })}
                  </span>
                </li>
                {training.certificate && (
                  <li className="flex items-start gap-2.5 text-[0.8125rem] text-ink-700">
                    <Award aria-hidden className="mt-px size-4 shrink-0 text-brand-600" />
                    <span className="leading-snug">{t('certificateOnFinish')}</span>
                  </li>
                )}
              </ul>
            )}

            <div className="mt-5">
              {product.owned ? (
                <Link
                  href={`/learn/${product.slug}`}
                  className="block rounded-(--radius-input) bg-brand-600 px-5 py-3.5 text-center text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  {t('owned')}
                </Link>
              ) : user ? (
                <BuyButton
                  productId={product.id}
                  label={t('buy')}
                  initialCoupon={sp.coupon ?? null}
                />
              ) : (
                /* Signed out. The click has already been recorded against the
                   visitor token, so signing up does not lose the attribution —
                   `attribute_order` binds on the token AND the account. */
                <Link
                  href="/signup"
                  className="block rounded-(--radius-input) bg-brand-600 px-5 py-3.5 text-center text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-700"
                >
                  {t('signUpToBuy')}
                </Link>
              )}
            </div>

            <p className="mt-3 text-center text-[0.75rem] leading-snug text-ink-500">
              {t('paymentNote')}
            </p>

            {/* ONLY ON A TRAINING PROGRAMME, because buying one is what makes
                somebody an affiliate. Their acceptance and its version are
                recorded on the account the purchase creates (H47): the
                mechanism had to exist from the start, since it cannot be
                added retroactively for people who already joined. */}
            {training && !product.owned && (
              <p className="mt-2 text-center text-[0.75rem] leading-snug text-ink-500">
                {t.rich('termsNote', {
                  terms: (chunks) => (
                    <Link href="/terms" className="font-medium text-brand-700 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}
