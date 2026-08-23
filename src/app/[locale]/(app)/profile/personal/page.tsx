import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AvatarUploader } from '@/components/profile/AvatarUploader'
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
 * language: the editable avatar up top (camera badge -> upload), then name and
 * phone, which the user may change as often as they like. Email is shown but
 * managed under Security.
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
        <div className="mb-6 flex justify-center">
          <AvatarUploader
            userId={user!.id}
            name={profile?.full_name ?? null}
            initialPath={profile?.avatar_path ?? null}
          />
        </div>

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
