import type { Metadata } from 'next'

import { PlayCircle } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export const metadata: Metadata = {
  title: 'Ads',
  robots: { index: false, follow: false },
}

/**
 * Ads tab — deliberate stub. The watching/earning flow (player, attention
 * question, result) is its own surface with its own design references
 * (design-references/ad-watching/), none received yet. The server side of
 * the earning loop is already built and tested.
 */
export default async function AdsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('adsTab')

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <Card>
        <CardHeader
          title={t('title')}
          description={t('description')}
          action={<Badge tone="neutral">{t('comingSoon')}</Badge>}
        />
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <PlayCircle aria-hidden className="size-6" />
          </span>
          <p className="max-w-[38ch] text-[0.8125rem] leading-relaxed text-ink-500">{t('body')}</p>
        </CardBody>
      </Card>
    </div>
  )
}
