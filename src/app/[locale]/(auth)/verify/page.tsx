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
  searchParams: Promise<{ email?: string; error?: string }>
}) {
  const { locale } = await params
  const { email, error } = await searchParams
  setRequestLocale(locale)

  /*
    The address comes through the URL so a refresh does not strand someone
    mid-verification. It is display-only: verification happens when the
    emailed link is redeemed at /auth/confirm, against a token this page never
    sees, so editing the parameter achieves nothing (§2.4).

    `error` is set by /auth/confirm when a link fails, so someone bounced back
    here is told why instead of staring at the same screen.
  */
  const linkError = error === 'expired' || error === 'link' ? error : undefined

  return (
    <AuthLayout compact>
      <VerifyFlow email={email ?? 'your email address'} linkError={linkError} />
    </AuthLayout>
  )
}
