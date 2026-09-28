import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { ManualPaymentView } from '@/components/upgrade/ManualPaymentView'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getManualPaymentConfig } from '@/lib/payments/manual'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Send your payment',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Where a Vault depositor who chose manual mobile money is told where to send it, and
 * says they have. Read by id AND owner: an id in a URL proves nothing.
 */
export default async function ManualPaymentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const [{ data }, config] = await Promise.all([
    createAdminClient()
      .from('vault_payments')
      .select('id, status, amount_minor, balance_minor, currency_code, manual_reference, manual_claimed_at, vault_plans(name)')
      .eq('id', id)
      .eq('user_id', user!.id)
      .maybeSingle(),
    getManualPaymentConfig(),
  ])

  const row = data as unknown as {
    id: string
    status: string
    amount_minor: number
    balance_minor: number | null
    currency_code: string
    manual_reference: string | null
    manual_claimed_at: string | null
    vault_plans: { name: string } | null
  } | null
  if (!row || !row.manual_reference) redirect({ href: '/vault', locale })

  return (
    <ManualPaymentView
      kind="vault"
      balanceMinor={Number(row!.balance_minor ?? 0)}
      totalMinor={row!.amount_minor}
      paymentId={row!.id}
      planName={row!.vault_plans?.name ?? ''}
      // A Vault row holds the FULL deposit; the cash is the rest.
      amountMinor={row!.amount_minor - Number(row!.balance_minor ?? 0)}
      currency={row!.currency_code}
      reference={row!.manual_reference!}
      state={
        row!.status === 'confirmed'
          ? 'confirmed'
          : row!.status !== 'pending'
            ? 'closed'
            : row!.manual_claimed_at
              ? 'waiting'
              : 'send'
      }
      number={config.number}
      accountName={config.accountName}
      network={config.network}
    />
  )
}
