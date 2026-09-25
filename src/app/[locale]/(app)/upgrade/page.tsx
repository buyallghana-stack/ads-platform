import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { UpgradeView } from '@/components/upgrade/UpgradeView'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { hubConfigured } from '@/lib/env'
import { getPaymentMethodSwitches } from '@/lib/payments/methods'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getHeldPlans,
  getPlanReferences,
  getPlans,
  getResolvedBenefits,
} from '@/lib/subscriptions/data'
import { getHeldTopups } from '@/lib/payments/topup-hold'
import { getUserPointsBalance } from '@/lib/vault/data'

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
  searchParams,
}: {
  params: Promise<{ locale: string }>
  /* `?coupon=CODE`, so a code can be shared as a link rather than typed from a
     broadcast message. It is only a prefill: the code is validated in SQL when
     the purchase starts, exactly as a typed one is. */
  searchParams: Promise<{ coupon?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const admin = createAdminClient()
  const [
    plans,
    held,
    benefits,
    references,
    { data: earningStatus },
    switches,
    balancePoints,
    { data: balanceSwitch },
    heldTopups,
  ] = await Promise.all([
    getPlans(),
    getHeldPlans(user!.id),
    getResolvedBenefits(user!.id),
    getPlanReferences(),
    admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
    /* Which ways to pay the checkout should LIST. Labels, not gates: the
       payment page belongs to the hub. See lib/payments/methods.ts. */
    getPaymentMethodSwitches(),
    getUserPointsBalance(user!.id),
    /* Private config, so read with the service client: through the user's
       token the row comes back missing and the option would silently vanish.
       The SQL refuses a balance purchase on its own when this is off. */
    admin
      .from('app_config')
      .select('value')
      .eq('key', 'plan_balance_purchase_enabled')
      .maybeSingle(),
    /* Balance set aside by an unfinished part-balance checkout, so the page
       can say where it went and offer it back. */
    getHeldTopups(user!.id),
  ])

  return (
    <UpgradeView
      plans={plans}
      held={held}
      benefits={benefits}
      freeEarningOver={Boolean(earningStatus?.free_earning_over)}
      freeDailyAdCap={references.freeDailyAdCap}
      freeName={references.freeName}
      baseAdPoints={references.baseAdPoints}
      pointsPerCurrencyUnit={references.pointsPerCurrencyUnit}
      checkoutEnabled={hubConfigured()}
      checkoutMethods={switches.checkout}
      balancePurchaseEnabled={balanceSwitch?.value === 'true'}
      balancePoints={balancePoints}
      heldTopups={heldTopups}
      initialCoupon={(await searchParams).coupon ?? null}
    />
  )
}
