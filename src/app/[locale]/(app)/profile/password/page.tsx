import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { ChangePasswordForm } from '@/components/profile/ChangePasswordForm'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { isTwoFactorEnabled } from '@/lib/security/login-2fa'

export const metadata: Metadata = {
  title: 'Change password',
  robots: { index: false, follow: false },
}

/** Change password — current password, plus a code when 2FA is on. */
export default async function ChangePasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  return <ChangePasswordForm needsCode={await isTwoFactorEnabled(user!.id)} />
}
