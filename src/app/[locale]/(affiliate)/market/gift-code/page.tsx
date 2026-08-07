import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { CommissionGiftCodeForm } from '@/components/affiliate/CommissionGiftCodeForm'
import { Link } from '@/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'affiliate.giftCode' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Gift codes on the affiliate side, reached from the tile row on /market.
 *
 * That tile used to leave the mode entirely and land on the ads screen, which
 * credits points. The note beside it argued this was acceptable because the
 * balances stay separate and the user simply walks between businesses. The
 * operator disagreed (2026-08-07) and is right: somebody on the cedis
 * dashboard tapping a tile on the cedis dashboard is asking for cedis.
 *
 * Nothing is loaded here. The form owns its state and the code is checked
 * server-side, because listing `commission_gift_codes` would hand somebody
 * every unredeemed voucher on the platform. RLS refuses it too; this is the
 * layer above.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('affiliate.giftCode')

  return (
    <div className="relative isolate mx-auto w-full max-w-[26rem] px-4 pb-10 pt-4 sm:px-6">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />
      <Link
        href="/market"
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>
      <CommissionGiftCodeForm />
    </div>
  )
}
