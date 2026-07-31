import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { AdminLeaderboard } from '@/components/admin/AdminLeaderboard'
import { getAdminLeaderboard } from '@/lib/admin/data/leaderboard'
import { isLeaderboardPeriod, type LeaderboardPeriod } from '@/lib/leaderboard/types'

export const metadata: Metadata = {
  title: 'Admin · Leaderboard',
  robots: { index: false, follow: false },
}

/**
 * The same ranking the users see, with the person attached.
 *
 * The period lives in the URL rather than in client state, unlike the user's
 * screen. Two reasons: the admin copy carries email and phone for up to 200
 * people, so fetching all four periods on every visit would move four times
 * that for three tabs nobody opened; and an operator looking at a suspicious
 * week wants to be able to send somebody the link.
 *
 * The admin guard is in `admin/layout.tsx`, and `admin_get_leaderboard`
 * re-checks the acting admin itself.
 */
export default async function AdminLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { period: raw } = await searchParams
  const t = await getTranslations('admin.leaderboard')

  const period: LeaderboardPeriod = isLeaderboardPeriod(raw) ? raw : 'week'
  const rows = await getAdminLeaderboard(period)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AdminLeaderboard rows={rows} period={period} />
    </>
  )
}
