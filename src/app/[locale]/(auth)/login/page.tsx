import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { LogInForm } from '@/components/auth/LogInForm'
import { redirect } from '@/i18n/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
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
   * Someone who already has a session does not belong on the login form,
   * UNLESS their account is currently scheduled for deletion (in which case
   * their session must be cleared so they can authenticate and see the
   * deletion cancellation choice).
   */
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('deletion_requested_at, deleted_at')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.deletion_requested_at && !profile.deleted_at) {
      await supabase.auth.signOut()
    } else {
      redirect({ href: '/dashboard', locale })
    }
  }

  return (
    <AuthLayout>
      <LogInForm />
    </AuthLayout>
  )
}
