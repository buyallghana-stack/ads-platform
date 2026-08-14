import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { VaultBoard } from '@/components/admin/VaultBoard'
import {
  getAllVaultInvestmentsAdmin,
  getAllVaultPlansAdmin,
  getVaultEnabled,
} from '@/lib/vault/data'

export const metadata: Metadata = {
  title: 'Vault Management',
  robots: { index: false, follow: false },
}

export default async function AdminVaultPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const [vaultEnabled, plans, investments] = await Promise.all([
    getVaultEnabled(),
    getAllVaultPlansAdmin(),
    getAllVaultInvestmentsAdmin(),
  ])

  return (
    <VaultBoard
      vaultEnabled={vaultEnabled}
      plans={plans}
      investments={investments}
    />
  )
}
