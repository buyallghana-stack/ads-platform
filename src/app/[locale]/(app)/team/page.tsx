import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { TeamView } from '@/components/team/TeamView'
import { getViewerUser } from '@/lib/auth/session'
import { getTeamData } from '@/lib/team/data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'team' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * The Team tab — the fifth destination, between Upgrade and Profile.
 *
 * Rendered per request and never cached. It reports other people's balances
 * and withdrawals, and a figure somebody is being asked to trust must not be
 * a cached one from an hour ago. The auth guard lives in `(app)/layout.tsx`.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) return null

  const data = await getTeamData(user.id)

  return <TeamView data={data} />
}
