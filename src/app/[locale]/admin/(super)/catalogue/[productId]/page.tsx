import type { Metadata } from 'next'

import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { ProductEditor } from '@/components/admin/ProductEditor'
import { Link } from '@/i18n/navigation'
import { getProduct, getPublishBlockers, listVendors } from '@/lib/admin/catalogue-data'

export const metadata: Metadata = {
  title: 'Product',
  robots: { index: false, follow: false },
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; productId: string }>
}) {
  const { locale, productId } = await params
  setRequestLocale(locale)

  const [product, vendors, blockers] = await Promise.all([
    getProduct(productId),
    listVendors(),
    getPublishBlockers(productId),
  ])
  if (!product) notFound()

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5">
        <Link
          href="/admin/catalogue"
          className="text-[0.75rem] font-medium text-ink-500 hover:text-ink-800"
        >
          ← Catalogue
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {product.title}
        </h1>
      </header>
      <ProductEditor product={product} vendors={vendors} blockers={blockers} />
    </div>
  )
}
