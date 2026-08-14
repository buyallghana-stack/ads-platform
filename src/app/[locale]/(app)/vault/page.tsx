import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { VaultView } from '@/components/vault/VaultView'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { serverEnv } from '@/lib/env'
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

  const [vaultEnabled, plans, investments, userBalancePoints, pointsRate] = await Promise.all([
    getVaultEnabled(),
    getVaultPlans(),
    getUserVaultInvestments(user.id),
    getUserPointsBalance(user.id),
    getPointsPerCurrencyUnit(),
  ])

  return (
    <VaultView
      vaultEnabled={vaultEnabled}
      plans={plans}
      investments={investments}
      userBalancePoints={userBalancePoints}
      pointsRate={pointsRate}
      checkoutEnabled={Boolean(serverEnv().PAYSTACK_SECRET_KEY)}
    />
  )
}
