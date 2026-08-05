import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { ChangeEmailForm } from '@/components/profile/ChangeEmailForm'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { isTwoFactorEnabled } from '@/lib/security/login-2fa'

export const metadata: Metadata = {
  title: 'Change email',
  robots: { index: false, follow: false },
}

/** Change the sign-in email. Confirmed from the new address before it takes effect. */
export default async function ChangeEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  return (
    <ChangeEmailForm
      currentEmail={user!.email ?? ''}
      needsCode={await isTwoFactorEnabled(user!.id)}
    />
  )
}
