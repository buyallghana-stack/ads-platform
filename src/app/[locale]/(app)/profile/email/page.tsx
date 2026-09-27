import { setRequestLocale } from 'next-intl/server'

import { redirect } from '@/i18n/navigation'

/** Retired 2026-09-27: the sign-in is a phone now. Old links land on its screen. */
export default async function ChangeEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  redirect({ href: '/profile/phone', locale })
}
