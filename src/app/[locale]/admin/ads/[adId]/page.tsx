import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { setRequestLocale } from 'next-intl/server'

import { AdEditor } from '@/components/admin/AdEditor'
import { getAdDraft, getAdEditorContext } from '@/lib/admin/ads-data'

export const metadata: Metadata = {
  title: 'Admin · Edit ad',
  robots: { index: false, follow: false },
}

export default async function EditAdPage({
  params,
}: {
  params: Promise<{ locale: string; adId: string }>
}) {
  const { locale, adId } = await params
  setRequestLocale(locale)

  const [draft, context] = await Promise.all([getAdDraft(adId), getAdEditorContext()])
  if (!draft) notFound()

  return <AdEditor initial={draft} tiers={context.tiers} pointsPerGhs={context.pointsPerGhs} />
}
