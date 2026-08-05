import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { DeleteAccountFlow } from '@/components/profile/DeleteAccountFlow'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { isTwoFactorEnabled } from '@/lib/security/login-2fa'

export const metadata: Metadata = {
  title: 'Delete account',
  robots: { index: false, follow: false },
}

/**
 * Delete account. The authenticator step only appears for accounts that have
 * one — asking for a code nobody can produce would make deletion impossible
 * for every user who has not enrolled.
 */
export default async function DeleteAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  return <DeleteAccountFlow needsCode={await isTwoFactorEnabled(user!.id)} />
}
