import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { WithdrawWizard } from '@/components/withdraw/WithdrawWizard'
import { redirect } from '@/i18n/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Withdraw',
  robots: { index: false, follow: false },
}

/**
 * Withdrawal page — the stepped wizard, reached from the balance hero.
 *
 * Balance and the tier's redemption minimum are REAL (they anchor the amount
 * validation); the payout accounts and PIN inside the wizard are demo data
 * until the Profile tab ships account + PIN setup, and submission writes
 * nothing. See WithdrawWizard for the full demo contract.
 */
export default async function WithdrawPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  const admin = createAdminClient()
  const [{ data: status }, { data: tier }] = await Promise.all([
    admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
    // The demo accounts are all on the default tier; resolve_user_tier is
    // internal-only, so the default tier's minimum is the honest source
    // until the Upgrade tab makes tiers switchable.
    supabase
      .from('tiers')
      .select('redemption_minimum_points')
      .eq('is_default', true)
      .maybeSingle(),
  ])

  return (
    <WithdrawWizard
      balance={status?.balance ?? 0}
      minPoints={tier?.redemption_minimum_points ?? 5000}
    />
  )
}
