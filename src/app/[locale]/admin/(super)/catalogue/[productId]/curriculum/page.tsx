import type { Metadata } from 'next'

import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { CurriculumBuilder } from '@/components/admin/CurriculumBuilder'
import { Link } from '@/i18n/navigation'
import { getAdminCurriculum, getProduct } from '@/lib/admin/catalogue-data'

export const metadata: Metadata = {
  title: 'Curriculum',
  robots: { index: false, follow: false },
}

export default async function CurriculumPage({
  params,
}: {
  params: Promise<{ locale: string; productId: string }>
}) {
  const { locale, productId } = await params
  setRequestLocale(locale)

  const [product, sections] = await Promise.all([
    getProduct(productId),
    getAdminCurriculum(productId),
  ])
  if (!product) notFound()

  const lessons = sections.reduce((n, s) => n + s.lessons.length, 0)

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5">
        <Link
          href={`/admin/catalogue/${productId}`}
          className="text-[0.75rem] font-medium text-ink-500 hover:text-ink-800"
        >
          ← {product.title}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink-900">Curriculum</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">
          {lessons === 0
            ? 'Nothing in this course yet.'
            : `${lessons} lesson${lessons === 1 ? '' : 's'} across ${sections.length} section${sections.length === 1 ? '' : 's'}.`}
        </p>
      </header>
      <CurriculumBuilder productId={productId} sections={sections} />
    </div>
  )
}
