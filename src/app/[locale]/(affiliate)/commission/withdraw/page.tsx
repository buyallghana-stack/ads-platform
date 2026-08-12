import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'
import { CommissionWithdraw } from '@/components/affiliate/CommissionWithdraw'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateDashboard, getAffiliateStatement } from '@/lib/market/data'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Withdraw commission',
  robots: { index: false, follow: false },
}

/** Enough of a destination to recognise, never enough to misuse. */
function maskTail(v: string, keep = 4) {
  return v.length <= keep ? v : '••••' + v.slice(-keep)
}
function maskWallet(v: string) {
  return v.length <= 12 ? v : v.slice(0, 6) + '…' + v.slice(-6)
}

/**
 * Withdrawing commission.
 *
 * ── THE DESTINATION IS SHARED WITH POINTS, THE MONEY IS NOT ──
 *
 * `user_payout_details` is one row per person and both businesses pay to it.
 * That is correct and deliberate: it is where somebody's money goes, not which
 * product it came from, and keeping two would mean two things to keep current
 * and one of them silently stale. The 48-hour cool-off after a change protects
 * both paths for the same reason — take over an account, change the
 * destination, withdraw before anybody notices.
 *
 * What is NOT shared is the balance, the minimum, the ledger or the queue.
 *
 * ── THE FEE IS READ FROM CONFIG, NOT ASSUMED ──
 *
 * `redemption_fee_percent` is one fee for the whole platform (operator,
 * 2026-08-06) and `request_commission_payout` freezes it onto the row. Read
 * with the SERVICE client, because `app_config`'s select policy is
 * `is_public OR is_admin()` — a user client reading a private key gets NULL
 * silently and looks correct to whoever tests it as an admin. That trap has
 * bitten this repo before.
 */
export default async function CommissionWithdrawPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const admin = createAdminClient()

  const [
    dashboard,
    { data: configRows },
    { data: details },
    statement,
  ] = await Promise.all([
    getAffiliateDashboard(user!.id),
    admin.from('app_config').select('key, value').in('key', ['redemption_fee_percent']),
    admin
      .from('user_payout_details')
      .select(
        'method, msisdn, account_name, wallet_address, provider:payout_providers(name), coin:payout_coins(code), network:payout_coin_networks(name)',
      )
      /* ⚠️ NOT `.maybeSingle()`. `user_payout_details` is keyed
         (user_id, method), so a person may hold BOTH a mobile money row and a
         crypto one, and `.maybeSingle()` errors on two rows and hands back
         null — which this screen read as "no destination at all". Adding a
         second payout method therefore removed the first from the product,
         which is what the operator hit on 2026-08-12. The ads withdrawal has
         always read this table as an array, which is why it never broke. */
      .eq('user_id', user!.id),
    /* One open request at a time is a unique INDEX in the database, so
         without this the form is fillable and the refusal arrives as
         `duplicate key value violates unique constraint …`. The action still
         handles that race — two tabs — but nobody should reach it by walking
         in the front door.

         Read through the statement rather than the table: `affiliate_statement`
         returns EVERY payout regardless of `p_limit` (the limit applies to
         ledger entries only), so `1` is the cheapest call that still sees all
         of them, and this page and /commission then agree by construction. */
    getAffiliateStatement(user!.id, 1),
  ])

  const feePercent = Number(
    (configRows ?? []).find((r) => r.key === 'redemption_fee_percent')?.value ?? 0,
  )

  /* Every destination they hold, masked. Mobile money first: it is what almost
     everybody uses, so it is the one that should be selected on arrival. */
  const destinations = (details ?? [])
    .map((row) =>
      row.method === 'mobile_money' && row.provider
        ? {
            method: 'mobile_money' as const,
            title: row.provider.name,
            detail: `${maskTail(row.msisdn ?? '')} · ${row.account_name ?? ''}`,
          }
        : row.method === 'crypto' && row.coin
          ? {
              method: 'crypto' as const,
              title: `${row.coin.code}${row.network?.name ? ` · ${row.network.name}` : ''}`,
              detail: maskWallet(row.wallet_address ?? ''),
            }
          : null,
    )
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => (a.method === 'mobile_money' ? -1 : b.method === 'mobile_money' ? 1 : 0))

  return (
    /*
      ⚠️ THE SAME FRAME AS THE ADS WITHDRAWAL, deliberately (operator,
      2026-08-12: "the affiliate withdrawal ui doesnt meet the same design
      pattern as the ads").

      What changed: this was a 2xl page with a text back link, a 1.625rem
      display heading and a subtitle, sitting on the brand wash. Withdrawing
      money on the ads side is a narrow 26rem column with a circular back
      button, one small title and a progress bar, and nothing else competing
      for the screen. Two screens that take money out of the same platform
      should not feel like two products.

      The header and the progress bar moved INTO the client component, because
      only it knows which stage the person is on. This page is now the column
      and nothing more.

      What did NOT change is the number of steps. The ads flow has four because
      points are not money and it has to explain a peg, convert, and take a
      PIN. Commission is already cedis, so this stays two. Matching the chrome
      is the ask; inventing steps to match a count would be worse than the
      inconsistency.
    */
    <div className="mx-auto w-full max-w-[26rem] px-5 pt-4 pb-10 sm:px-0 md:pt-8">
      <CommissionWithdraw
        balanceMinor={dashboard.balance_minor ?? 0}
        minimumMinor={dashboard.payout_minimum_minor ?? 0}
        feePercent={Number.isFinite(feePercent) ? feePercent : 0}
        destinations={destinations}
        payoutsEnabled={dashboard.payouts_enabled ?? false}
        openRequest={statement.payouts.some(
          (p) => p.status === 'requested' || p.status === 'approved',
        )}
      />
    </div>
  )
}
