import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { LogInForm } from '@/components/auth/LogInForm'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.logIn' })
  return { title: t('title') }
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  /*
   * Someone who already has a session does not belong on the login form.
   * Found in production (2026-07-24): a phone user's login succeeded and set
   * its cookie, but the client-side navigation to the dashboard was
   * interrupted — leaving them "stuck" on a login form that showed no hint
   * they were in fact signed in. With this check, any arrival here while
   * authenticated — retry, refresh, revisiting the link — lands on the
   * dashboard instead.
   */
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect({ href: '/dashboard', locale })

  return (
    <AuthLayout>
      <LogInForm />
    </AuthLayout>
  )
}
