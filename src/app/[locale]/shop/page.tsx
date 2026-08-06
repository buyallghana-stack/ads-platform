import { setRequestLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'

import { MarketHeader } from '@/components/market/MarketHeader'
import { ShopShelf } from '@/components/market/ShopShelf'
import { getViewerUser } from '@/lib/auth/session'
import { getShopProducts } from '@/lib/market/data'

export default async function ShopPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('market.shop')
  const user = await getViewerUser()
  const products = await getShopProducts(user?.id)

  return (
    <>
      <MarketHeader title={t('title')} description={t('subtitle')} bare={!user} />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
        <ShopShelf products={products} />
      </div>
    </>
  )
}
