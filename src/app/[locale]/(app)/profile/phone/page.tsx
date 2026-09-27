import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { ChangePhoneForm } from '@/components/profile/ChangePhoneForm'
import { redirect } from '@/i18n/navigation'
import { formatPhone } from '@/lib/auth/phone'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { isTwoFactorEnabled } from '@/lib/security/login-2fa'

export const metadata: Metadata = {
  title: 'Change phone number',
  robots: { index: false, follow: false },
}

/** Change the sign-in phone. Proved by a code texted to the new number. */
export default async function ChangePhonePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const [needsCode, profile] = await Promise.all([isTwoFactorEnabled(user!.id), getProfile(user!.id)])

  return (
    <ChangePhoneForm
      currentPhone={profile?.phone ? formatPhone(profile.phone) : ''}
      needsCode={needsCode}
    />
  )
}
