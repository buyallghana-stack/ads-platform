import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { VerifyFlow } from '@/components/auth/VerifyFlow'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.verify.checkEmail' })
  return { title: t('title') }
}

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ email?: string }>
}) {
  const { locale } = await params
  const { email } = await searchParams
  setRequestLocale(locale)

  /*
    The address comes through the URL so a refresh does not strand someone
    mid-verification. It is display-only — the server verifies the code
    against the session, never against whatever this parameter says, so
    editing it achieves nothing (§2.4).
  */
  return (
    <AuthLayout compact>
      <VerifyFlow email={email ?? 'your email address'} />
    </AuthLayout>
  )
}
