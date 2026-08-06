import { setRequestLocale, getTranslations } from 'next-intl/server'

import { ShopScreen } from '@/components/market/ShopScreen'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { getShopProducts } from '@/lib/market/data'

/**
 * The shop.
 *
 * Public — outside the authenticated route group — because an affiliate link is
 * sent to strangers by definition. A signed-out visitor gets the same catalogue
 * and a welcome instead of their name.
 */
export default async function ShopPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('market.shop')
  const common = await getTranslations('common')
  const user = await getViewerUser()

  const [products, profile] = await Promise.all([
    getShopProducts(user?.id),
    user ? getProfile(user.id) : Promise.resolve(null),
  ])

  /* First name only. "Welcome, Emmanuel" is a greeting; "Welcome, Emmanuel
     Kwabena Ofori" is a database record read aloud. */
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null

  return (
    <ShopScreen
      products={products}
      greetingName={firstName}
      platformName={common('appName')}
      labels={{
        welcome: firstName ? t('welcome') : t('welcomeAnon'),
        browse: t('browse'),
        searchPlaceholder: t('searchPlaceholder'),
        all: t('all'),
        featured: t('featured'),
        everything: t('everything'),
        viewAll: t('viewAll'),
        owned: t('owned'),
        emptyTitle: t('empty.title'),
        emptyBody: t('empty.body'),
        noMatch: t('noMatch'),
      }}
    />
  )
}
