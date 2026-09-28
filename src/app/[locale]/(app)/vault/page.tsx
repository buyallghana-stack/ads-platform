import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { VaultView } from '@/components/vault/VaultView'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getManualPaymentConfig, paystackCheckoutEnabled } from '@/lib/payments/manual'
import {
  getVaultEnabled,
  getVaultPlans,
  getUserVaultInvestments,
  getUserPointsBalance,
  getPointsPerCurrencyUnit,
} from '@/lib/vault/data'

export const metadata: Metadata = {
  title: 'Vault',
  robots: { index: false, follow: false },
}

export default async function VaultPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) {
    redirect({ href: '/login', locale })
    return null
  }

  const [vaultEnabled, plans, investments, userBalancePoints, pointsRate, paystackOn, manual] = await Promise.all([
    getVaultEnabled(),
    getVaultPlans(),
    getUserVaultInvestments(user.id),
    getUserPointsBalance(user.id),
    getPointsPerCurrencyUnit(),
    paystackCheckoutEnabled(),
    getManualPaymentConfig(),
  ])

  return (
    <VaultView
      vaultEnabled={vaultEnabled}
      plans={plans}
      investments={investments}
      userBalancePoints={userBalancePoints}
      pointsRate={pointsRate}
      checkoutEnabled={paystackOn}
      manualEnabled={manual.enabled}
      manualClosedUntil={manual.closedForNight ? manual.openHour : null}
    />
  )
}
