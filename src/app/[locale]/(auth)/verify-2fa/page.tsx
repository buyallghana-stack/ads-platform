import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { LoginChallengeForm } from '@/components/auth/LoginChallengeForm'
import { redirect } from '@/i18n/navigation'
import { landingFor } from '@/lib/auth/landing'
import { getSessionUser } from '@/lib/auth/session'
import { hasPassedLoginChallenge, isTwoFactorEnabled } from '@/lib/security/login-2fa'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'twoFactor.challenge' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Sign-in challenge for accounts with 2FA on.
 *
 * Reached with a valid session that is not yet trusted. Anyone who does not
 * belong here is sent on: no session means sign in first, no 2FA or an already
 * satisfied challenge means there is nothing to do.
 */
export default async function VerifyTwoFactorPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  // Both of these mean "nothing to challenge here" — send them wherever they
  // belong rather than always to the user app.
  const home = await landingFor(user!.id)
  if (!(await isTwoFactorEnabled(user!.id))) redirect({ href: home, locale })
  if (await hasPassedLoginChallenge(user!.id)) redirect({ href: home, locale })

  return (
    <AuthLayout compact>
      <LoginChallengeForm />
    </AuthLayout>
  )
}
