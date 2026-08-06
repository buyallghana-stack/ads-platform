import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { ProductEditor } from '@/components/admin/ProductEditor'
import { listVendors } from '@/lib/admin/catalogue-data'

export const metadata: Metadata = {
  title: 'New product',
  robots: { index: false, follow: false },
}

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const vendors = await listVendors()

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink-900">New product</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">
          It starts as a draft. Nothing goes on sale until you build the content and publish it.
        </p>
      </header>
      <ProductEditor product={null} vendors={vendors} blockers={[]} />
    </div>
  )
}
