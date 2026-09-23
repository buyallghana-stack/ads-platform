import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { OnboardingStepsEditor, type StepRow } from '@/components/admin/OnboardingStepsEditor'
import { Link } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Admin · Onboarding',
  robots: { index: false, follow: false },
}

/**
 * The first-run walkthrough: what a new member is walked through, and in what
 * order.
 *
 * The MASTER switch is not duplicated here. It is `onboarding_enabled` on the
 * settings screen with every other switch, and a second copy of a switch is a
 * second thing to disagree with the first. This page links to it instead.
 */
export default async function AdminOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.onboarding')

  const user = await getSessionUser()
  const admin = createAdminClient()
  const { data } = await admin.rpc('admin_list_onboarding_steps', { p_admin_id: user!.id })

  const rows: StepRow[] = (data ?? []).map((r) => ({
    key: r.key,
    sortOrder: r.sort_order,
    isEnabled: r.is_enabled,
    isDerived: r.is_derived,
  }))

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <p className="mb-4 text-[0.8125rem] leading-relaxed text-ink-600">
        {t.rich('switchHint', {
          settings: (chunks) => (
            <Link href="/admin/config" className="font-semibold text-brand-700 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>

      <OnboardingStepsEditor initial={rows} />
    </>
  )
}
