import type { Metadata } from 'next'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CommissionWithdraw } from '@/components/affiliate/CommissionWithdraw'
import { Link, redirect } from '@/i18n/navigation'
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

  const t = await getTranslations('affiliate.withdraw')
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
      .eq('user_id', user!.id)
      .maybeSingle(),
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

  const destination =
    details?.method === 'mobile_money' && details.provider
      ? {
          method: 'mobile_money' as const,
          title: details.provider.name,
          detail: `${maskTail(details.msisdn ?? '')} · ${details.account_name ?? ''}`,
        }
      : details?.method === 'crypto' && details.coin
        ? {
            method: 'crypto' as const,
            title: `${details.coin.code}${details.network?.name ? ` · ${details.network.name}` : ''}`,
            detail: maskWallet(details.wallet_address ?? ''),
          }
        : null

  return (
    <div className="relative isolate mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <Link
        href="/commission"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      <CommissionWithdraw
        balanceMinor={dashboard.balance_minor ?? 0}
        minimumMinor={dashboard.payout_minimum_minor ?? 0}
        feePercent={Number.isFinite(feePercent) ? feePercent : 0}
        destination={destination}
        payoutsEnabled={dashboard.payouts_enabled ?? false}
        openRequest={statement.payouts.some(
          (p) => p.status === 'requested' || p.status === 'approved',
        )}
      />
    </div>
  )
}
