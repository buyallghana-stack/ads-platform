import type { Metadata } from 'next'

import { UserRound } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export const metadata: Metadata = {
  title: 'Profile',
  robots: { index: false, follow: false },
}

/**
 * Profile tab — deliberate stub. Will hold account details, payout details
 * (§6.5 with its 48h cool-off), language and theme settings, and log out.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('profileTab')

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <Card>
        <CardHeader
          title={t('title')}
          description={t('description')}
          action={<Badge tone="neutral">{t('comingSoon')}</Badge>}
        />
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-teal-50 text-teal-600">
            <UserRound aria-hidden className="size-6" />
          </span>
          <p className="max-w-[38ch] text-[0.8125rem] leading-relaxed text-ink-500">{t('body')}</p>
        </CardBody>
      </Card>
    </div>
  )
}
