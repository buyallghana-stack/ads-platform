import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { UpgradeView } from '@/components/upgrade/UpgradeView'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { serverEnv } from '@/lib/env'
import {
  getHeldPlans,
  getPlanReferences,
  getPlans,
  getResolvedBenefits,
} from '@/lib/subscriptions/data'

export const metadata: Metadata = {
  title: 'Upgrade',
  robots: { index: false, follow: false },
}

/**
 * Upgrade tab. Plans come from the tiers table, so the operator can change
 * pricing and benefits from the admin dashboard later without this screen
 * being touched.
 *
 * Checkout turns itself on when Paystack is configured. Without the key the
 * sheet says so plainly rather than offering a button that cannot complete.
 */
export default async function UpgradePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const [plans, held, benefits, references] = await Promise.all([
    getPlans(),
    getHeldPlans(user!.id),
    getResolvedBenefits(user!.id),
    getPlanReferences(),
  ])

  return (
    <UpgradeView
      plans={plans}
      held={held}
      benefits={benefits}
      freeDailyAdCap={references.freeDailyAdCap}
      freeName={references.freeName}
      pointsPerCurrencyUnit={references.pointsPerCurrencyUnit}
      checkoutEnabled={Boolean(serverEnv().PAYSTACK_SECRET_KEY)}
    />
  )
}
