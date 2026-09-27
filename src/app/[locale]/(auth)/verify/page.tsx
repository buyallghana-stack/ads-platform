import { setRequestLocale } from 'next-intl/server'

import { redirect } from '@/i18n/navigation'

/**
 * The old "check your email" screen. Signup no longer sends an email (the SMS
 * code is the verification, since 2026-09-27), so anybody arriving here from
 * an old link or bookmark goes to the phone screen, which sends them to sign
 * in first if they have no session.
 */
export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  redirect({ href: '/verify-phone', locale })
}
