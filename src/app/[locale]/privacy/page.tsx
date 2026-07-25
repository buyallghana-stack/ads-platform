import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LegalDocument } from '@/components/legal/LegalDocument'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return { title: t('privacy.title') }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LegalDocument kind="privacy" locale={locale} />
}
