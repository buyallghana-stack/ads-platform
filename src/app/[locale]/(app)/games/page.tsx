import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { GamesHub } from '@/components/games/GamesHub'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getGameStatus } from '@/lib/games/data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'games' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Games hub.
 *
 * 404s when `games_enabled` is off rather than showing a "coming soon" page.
 * The switch is off for a legal reason — paying for chances at a random prize
 * is a licensing question in Ghana — and a screen advertising a game the
 * operator may not legally run is worse than no screen. `getGameStatus`
 * defaults to disabled when its read fails, so the failure mode is also 404.
 *
 * ⚠️ THE ALLOWANCE IS THE VIEWER'S, NOT THE CALLER'S. `getViewerUser()` is the
 * person a super admin is looking at under "view as user"; the Supabase
 * session stays the admin's throughout. Reading the status without an id
 * printed the admin's plays on the user's screen, which is how a free account
 * — allowance zero — came to show three.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const status = await getGameStatus(user!.id)
  if (!status.enabled) notFound()

  return <GamesHub status={status} />
}
