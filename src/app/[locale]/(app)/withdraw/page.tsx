import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { WithdrawWizard, type WithdrawAccount } from '@/components/withdraw/WithdrawWizard'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { getResolvedBenefits } from '@/lib/subscriptions/data'
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
 * REAL END TO END as of 2026-07-29: the accounts are the user's saved payout
 * details, the PIN is verified server-side, and confirming files a real
 * `request_redemption` — points leave the balance and the request lands in
 * the admin payout queue.
 *
 * The licence switches (`payouts_enabled`, `PAYOUTS_ENABLED`) gate
 * DISBURSEMENT only, not this. A user can queue a request and an operator can
 * review it while both are off; the one thing nobody can do is mark it paid.
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

  const [{ data: status }, benefits, { data: rateRow }, detailsRes] = await Promise.all([
    admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
    /*
      The user's RESOLVED tier, not the default one.

      This read used to be `tiers where is_default = true`, which is the FREE
      tier — so every subscriber was told the free 5,000-point minimum while
      request_redemption would happily have accepted their real, lower one.
      Every paid plan advertises a lower payout threshold on the Upgrade
      screen (down to 1,000 points on Platinum) and the stacking note promises
      "the lowest payout threshold applies", so the old read withheld a
      benefit people had paid for. resolve_user_tier already does the
      combining; this screen must not second-guess it.
    */
    getResolvedBenefits(user!.id),
    // The points→GHS rate is operator config, not a constant. Every other
    // screen reads it; this one used to hardcode 1000.
    admin.from('app_config').select('value').eq('key', 'points_per_currency_unit').maybeSingle(),
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
      minPoints={benefits?.redemptionMinimumPoints ?? 5000}
      pointsPerCurrencyUnit={Number(rateRow?.value ?? 1000)}
      tierName={benefits?.name ?? ''}
      accounts={accounts}
    />
  )
}
