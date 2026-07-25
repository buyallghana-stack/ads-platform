import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { BackupCodesManager } from '@/components/profile/BackupCodesManager'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { getTwoFactorStatus } from '@/lib/security/two-factor-data'

export const metadata: Metadata = {
  title: 'Backup codes',
  robots: { index: false, follow: false },
}

/** Backup codes — how many are left, and a way to mint a fresh set. */
export default async function BackupCodesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const status = await getTwoFactorStatus()

  return (
    <BackupCodesManager
      enabled={status.enabled}
      remaining={status.backupCodesRemaining}
      total={status.backupCodesTotal}
    />
  )
}
