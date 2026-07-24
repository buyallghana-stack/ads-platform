import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { WithdrawWizard, type WithdrawAccount } from '@/components/withdraw/WithdrawWizard'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Withdraw',
  robots: { index: false, follow: false },
}

/** Show enough of a destination to recognise it, not enough to misuse. */
function maskTail(v: string, keep = 4) {
  return v.length <= keep ? v : '••••' + v.slice(-keep)
}
function maskWallet(v: string) {
  return v.length <= 12 ? v : v.slice(0, 6) + '…' + v.slice(-6)
}

/**
 * Withdrawal page — the stepped wizard, reached from the balance hero.
 *
 * Now wired to the user's REAL saved payout accounts and REAL withdrawal PIN.
 * The final submission is still demo-badged (nothing is written; the real
 * request_redemption pipeline waits on PAYOUTS_ENABLED), but the account choice
 * and the PIN check are genuine.
 */
export default async function WithdrawPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const supabase = await createClient()
  const admin = createAdminClient()

  const [{ data: status }, { data: tier }, detailsRes] = await Promise.all([
    admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
    admin.from('tiers').select('redemption_minimum_points').eq('is_default', true).maybeSingle(),
    supabase
      .from('user_payout_details')
      .select(
        'method, msisdn, account_name, wallet_address, provider:payout_providers(name), coin:payout_coins(code), network:payout_coin_networks(name)',
      )
      .eq('user_id', user!.id),
  ])

  const accounts: WithdrawAccount[] = (detailsRes.data ?? []).flatMap((r): WithdrawAccount[] => {
    if (r.method === 'mobile_money' && r.provider) {
      return [
        {
          id: 'mobile_money',
          method: 'mobile_money' as const,
          title: r.provider.name,
          detail: `${maskTail(r.msisdn ?? '')} · ${r.account_name ?? ''}`,
        },
      ]
    }
    if (r.method === 'crypto' && r.coin) {
      return [
        {
          id: 'crypto',
          method: 'crypto' as const,
          title: `${r.coin.code}${r.network?.name ? ` · ${r.network.name}` : ''}`,
          detail: maskWallet(r.wallet_address ?? ''),
        },
      ]
    }
    return []
  })

  return (
    <WithdrawWizard
      balance={status?.balance ?? 0}
      minPoints={tier?.redemption_minimum_points ?? 5000}
      accounts={accounts}
    />
  )
}
