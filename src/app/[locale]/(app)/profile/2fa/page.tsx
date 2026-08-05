import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { TwoFactorFlow } from '@/components/profile/TwoFactorFlow'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getTwoFactorStatus } from '@/lib/security/two-factor-data'

export const metadata: Metadata = {
  title: 'Two-factor authentication',
  robots: { index: false, follow: false },
}

/**
 * Two-factor authentication. Status comes from `get_totp_status` — the only
 * 2FA function a client role may call, because it returns no secret and no
 * hash. Everything that touches the secret happens in the server actions.
 */
export default async function TwoFactorPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const status = await getTwoFactorStatus()

  return (
    <TwoFactorFlow
      enabled={status.enabled}
      confirmedAt={status.confirmedAt}
      backupCodesRemaining={status.backupCodesRemaining}
    />
  )
}
