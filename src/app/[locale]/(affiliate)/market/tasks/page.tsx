import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AffiliateTasks } from '@/components/affiliate/AffiliateTasks'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateTasks } from '@/lib/market/play'

export const metadata: Metadata = {
  title: 'Tasks',
  robots: { index: false, follow: false },
}

/**
 * Goals an affiliate can work towards, paid in cedis.
 *
 * Reached from the dashboard's shortcut row rather than the tab bar: five tabs
 * is the ceiling a bottom bar gets, and this is a place somebody visits when
 * they choose to, not a destination they live in.
 */
export default async function AffiliateTasksPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.tasks')
  const tasks = await getAffiliateTasks(user!.id)

  return (
    <div className="relative isolate mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <Link
        href="/market"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-500">{t('subtitle')}</p>
      </div>

      <AffiliateTasks initial={tasks} />
    </div>
  )
}
