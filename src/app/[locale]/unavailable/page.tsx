import type { Metadata } from 'next'

import { Globe, Info, ShieldAlert, Sparkles } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { FormHeader } from '@/components/auth/FormHeader'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'regionUnavailable' })
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  }
}

/**
 * Region Unavailable screen (§6.9).
 *
 * Rendered when traffic arrives from outside Ghana (or without a verified GH
 * geo signal) while GEO_RESTRICTION_ENABLED is active. Explains the regulatory
 * and payout rationale in clean, accessible language.
 */
export default async function RegionUnavailablePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('regionUnavailable')

  return (
    <AuthLayout compact>
      <div className="flex flex-col">
        <FormHeader
          icon={<Globe aria-hidden className="size-5" />}
          title={t('title')}
          subtitle={t('subtitle')}
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-(--radius-card) border border-brand-500/20 bg-brand-50/60 p-4">
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-600" />
            <div>
              <p className="text-[0.8125rem] font-semibold text-brand-900">{t('reasonTitle')}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-brand-800/90">
                {t('reasonBody')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
            <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-500" />
            <div>
              <p className="text-[0.8125rem] font-semibold text-ink-900">{t('futureTitle')}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-600">
                {t('futureBody')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 px-1 pt-1">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-400" />
            <p className="text-xs leading-relaxed text-ink-500">
              {t('supportNote')}
            </p>
          </div>
        </div>
      </div>
    </AuthLayout>
  )
}
