import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { VerifyPhoneForm } from '@/components/auth/VerifyPhoneForm'
import { redirect } from '@/i18n/navigation'
import { landingFor } from '@/lib/auth/landing'
import { needsPhoneVerification } from '@/lib/auth/phone-gate'
import { formatPhone } from '@/lib/auth/phone'
import { getProfile, getSessionUser } from '@/lib/auth/session'
import { needsLoginChallenge } from '@/lib/security/login-2fa'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.verifyPhone' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Where the (app) layout holds an account that has not proved a phone.
 *
 * The second factor comes first: proving a phone is an account change, and an
 * unchallenged session must not be able to make one.
 */
export default async function VerifyPhonePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })
  if (await needsLoginChallenge(user!.id)) redirect({ href: '/verify-2fa', locale })
  if (!(await needsPhoneVerification(user!.id))) redirect({ href: await landingFor(user!.id), locale })

  const profile = await getProfile(user!.id)

  return (
    <AuthLayout compact>
      <VerifyPhoneForm defaultPhone={profile?.phone ? formatPhone(profile.phone) : ''} />
    </AuthLayout>
  )
}
