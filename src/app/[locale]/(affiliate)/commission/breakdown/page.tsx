import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { CommissionBreakdown } from '@/components/affiliate/CommissionBreakdown'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateBreakdown } from '@/lib/earnings/breakdown'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'commissionBreakdown' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Where an affiliate's commission came from.
 *
 * Under `/commission`, beside the statement rather than inside it: the
 * statement answers "what happened and when", this answers "where did it all
 * come from", and squeezing the second into a tab of the first is how the
 * affiliate business ended up with eight admin functions nobody could reach.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) return null

  const data = await getAffiliateBreakdown(user.id)
  if (!data) return null

  return <CommissionBreakdown data={data} />
}
