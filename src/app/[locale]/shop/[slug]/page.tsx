import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { MarketHeader } from '@/components/market/MarketHeader'
import { ProductDetail } from '@/components/market/ProductDetail'
import { Link } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { recordClick } from '@/lib/market/attribution'
import { getPromoteInfo, getShopProduct } from '@/lib/market/data'
import { getOrigin } from '@/lib/request-context'

/**
 * One product.
 *
 * ---------------------------------------------------------------------------
 * THIS IS WHERE AFFILIATE LINKS LAND
 *
 * An affiliate link is `/shop/<slug>?ref=<code>`. Arriving with a `ref` records
 * a click and sets the visitor cookie, and that click is the only reason any
 * commission is ever paid — `attribute_order` looks for it when the order is
 * confirmed. Without this call the sale still completes and NOBODY IS PAID,
 * with no error raised anywhere.
 *
 * It happens on the PRODUCT page rather than the shop index because
 * `affiliate_clicks.product_id` is NOT NULL: every link is product-specific by
 * design, and the index has no product to attribute a click to.
 *
 * Recorded before the page renders, so somebody who buys immediately is still
 * attributed. `recordClick` never throws — a bad code costs a click, not a
 * sale.
 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ ref?: string; subid?: string }>
}) {
  const { locale, slug } = await params
  const { ref, subid } = await searchParams
  setRequestLocale(locale)

  const user = await getViewerUser()
  const detail = await getShopProduct(slug, user?.id)
  if (!detail.ok) notFound()

  if (ref) {
    await recordClick({
      code: ref,
      productId: detail.product.id,
      userId: user?.id ?? null,
      landingUrl: `/shop/${slug}`,
      subid: subid ?? null,
    })
  }

  /* What this person could earn from promoting it, and whether they may. Null
     when signed out — a stranger has no affiliate standing to report. The
     origin is resolved here because the link has to be absolute to be
     copyable, and `window.location` does not exist while this renders. */
  const [promote, origin] = await Promise.all([
    user ? getPromoteInfo(user.id, detail.product.id) : Promise.resolve(null),
    getOrigin(),
  ])

  return (
    <>
      <MarketHeader title={detail.product.title} bare={!user} />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
        <Link
          href="/shop"
          className="mb-4 inline-block text-[0.75rem] font-medium text-ink-500 hover:text-ink-800"
        >
          ← Shop
        </Link>
        <ProductDetail
          detail={detail}
          signedIn={Boolean(user)}
          promote={promote}
          origin={origin}
        />
      </div>
    </>
  )
}
