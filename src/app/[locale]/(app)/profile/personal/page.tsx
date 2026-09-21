import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Card } from '@/components/ui/Card'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

import { PersonalInfoForm } from './PersonalInfoForm'

export const metadata: Metadata = {
  title: 'Personal information',
  robots: { index: false, follow: false },
}

/**
 * Personal information — a Profile sub-screen in the established settings
 * language: name and phone, which the user may change as often as they like.
 * Email is shown but managed under Security.
 *
 * The editable avatar that used to sit at the top of this card is gone
 * (operator decision, 2026-09-21). Everybody is drawn as their initials now,
 * here and on every list. See components/profile/Avatar.tsx.
 */
export default async function PersonalInfoPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('personal')
  const supabase = await createClient()
  const [profile, payoutRes] = await Promise.all([
    getProfile(user!.id),
    supabase
      .from('user_payout_details')
      .select('method, msisdn, provider:payout_providers(name)')
      .eq('user_id', user!.id)
      .maybeSingle(),
  ])

  const momoPhone =
    payoutRes.data?.method === 'mobile_money' && payoutRes.data.msisdn
      ? payoutRes.data.msisdn
      : profile?.phone ?? null

  const providerName =
    payoutRes.data?.method === 'mobile_money'
      ? ((payoutRes.data.provider as { name: string } | null)?.name ?? null)
      : null

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 md:py-7">
      <header className="flex items-center gap-3">
        <Link
          href="/profile"
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
          <p className="text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
        </div>
      </header>

      <Card className="animate-rise mt-4 px-5 py-6 sm:px-6">
        <PersonalInfoForm
          defaultName={profile?.full_name ?? ''}
          momoPhone={momoPhone}
          providerName={providerName}
          email={user!.email ?? ''}
        />
      </Card>
    </div>
  )
}
