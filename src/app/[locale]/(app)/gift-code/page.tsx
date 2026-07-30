import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { GiftCodeForm } from '@/components/gift/GiftCodeForm'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'giftCode' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Gift code redemption, reached from the shortcut row under the balance card.
 *
 * A page rather than a sheet: entering a 12-character code off a phone screen
 * wants the keyboard and the field to own the viewport, and the success state
 * has somewhere to go afterwards.
 *
 * Nothing is loaded here. The form owns its own state and the code is checked
 * server-side on submit — there is deliberately no client read of `gift_codes`
 * at all, because listing that table would hand somebody every unredeemed
 * voucher on the platform. RLS refuses it too; this is the layer above.
 *
 * The auth guard lives in `(app)/layout.tsx`, like every other tab.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className="mx-auto w-full max-w-[26rem] px-1 pb-10 pt-2">
      <GiftCodeForm />
    </div>
  )
}
