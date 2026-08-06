import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { CatalogueBoard } from '@/components/admin/CatalogueBoard'
import { listProducts } from '@/lib/admin/catalogue-data'

export const metadata: Metadata = {
  title: 'Catalogue',
  robots: { index: false, follow: false },
}

/**
 * The catalogue.
 *
 * No auth check here: `admin/(super)/layout.tsx` is what refuses, and the
 * `admin_*` RPCs call `assert_admin` underneath that. Three layers, and this
 * page is not one of them — putting a fourth check here would be the version
 * somebody later forgets to copy onto the next page.
 */
export default async function CataloguePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const rows = await listProducts()

  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink-900">Catalogue</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">
          Courses and ebooks, what they cost, and what is still missing before they can go on
          sale.
        </p>
      </header>
      <CatalogueBoard rows={rows} />
    </div>
  )
}
