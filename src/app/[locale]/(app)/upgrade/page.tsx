import type { Metadata } from 'next'

import { Gem } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export const metadata: Metadata = {
  title: 'Upgrade',
  robots: { index: false, follow: false },
}

/**
 * Upgrade tab — deliberate stub. Tiers and subscription payments are live in
 * the database (§6.7); this screen gets built against its own references,
 * with plan cards and payment flow.
 */
export default async function UpgradePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('upgradeTab')

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <Card>
        <CardHeader
          title={t('title')}
          description={t('description')}
          action={<Badge tone="brand">{t('comingSoon')}</Badge>}
        />
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-violet-50 text-violet-600">
            <Gem aria-hidden className="size-6" />
          </span>
          <p className="max-w-[38ch] text-[0.8125rem] leading-relaxed text-ink-500">{t('body')}</p>
        </CardBody>
      </Card>
    </div>
  )
}
