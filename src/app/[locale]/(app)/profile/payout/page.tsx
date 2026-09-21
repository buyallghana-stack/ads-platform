import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { PayoutAccountsForm } from '@/components/profile/PayoutAccountsForm'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getPaymentMethodSwitches } from '@/lib/payments/methods'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Payout accounts',
  robots: { index: false, follow: false },
}

/**
 * Payout accounts (§6.4.1) — where a user saves where their cash-outs go.
 *
 * Real, not demo: reads through the user's own session (RLS grants own-row
 * reads on the detail and active-only reads on the option lists), and saves
 * through the server action + set_payout_details. One saved destination per
 * method (Mobile Money, crypto), which is what the schema's composite key
 * allows.
 */
export default async function PayoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  /*
    WHERE TO GO BACK TO (operator, 2026-08-07).

    One payout account serves both businesses, so an affiliate with no
    destination is sent here — across the mode boundary, into a screen wearing
    the other business's colours. Before this they were simply left here, four
    taps from the withdrawal they were in the middle of.

    ⚠️ THE VALUE IS NOT TRUSTED. An open redirect parameter is an open redirect
    parameter even when it only ever holds one of two words, so this is an
    allow-list of two known routes and anything else falls back. Never
    `redirect(searchParams.from)`.
  */
  const from = (await searchParams).from
  const returnTo = from === 'withdraw' ? '/withdraw' : null

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const supabase = await createClient()
  const [switches, detailsRes, providersRes, coinsRes, networksRes] = await Promise.all([
    /* Which rails are open. A method the operator has switched off is not
       drawn at all: `set_payout_details` refuses it anyway, so offering the
       form would be offering a save that cannot succeed. */
    getPaymentMethodSwitches(),
    supabase
      .from('user_payout_details')
      .select(
        'method, msisdn, account_name, wallet_address, provider:payout_providers(id,name,code), coin:payout_coins(id,code,name), network:payout_coin_networks(id,code,name)',
      )
      .eq('user_id', user!.id),
    supabase.from('payout_providers').select('id,name,code').eq('is_active', true).order('sort_order'),
    supabase
      .from('payout_coins')
      .select('id,code,name,requires_network')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('payout_coin_networks')
      .select('id,code,name,coin_id')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  const rows = detailsRes.data ?? []
  const momoRow = rows.find((r) => r.method === 'mobile_money')
  const cryptoRow = rows.find((r) => r.method === 'crypto')

  const momoSaved = momoRow?.provider
    ? {
        providerId: momoRow.provider.id,
        providerName: momoRow.provider.name,
        msisdn: momoRow.msisdn ?? '',
        accountName: momoRow.account_name ?? '',
      }
    : null

  const cryptoSaved = cryptoRow?.coin
    ? {
        coinId: cryptoRow.coin.id,
        coinCode: cryptoRow.coin.code,
        networkId: cryptoRow.network?.id ?? null,
        networkName: cryptoRow.network?.name ?? null,
        walletAddress: cryptoRow.wallet_address ?? '',
      }
    : null

  return (
    <PayoutAccountsForm
      momoSaved={momoSaved}
      cryptoSaved={cryptoSaved}
      momoEnabled={switches.payout.mobileMoney}
      cryptoEnabled={switches.payout.crypto}
      providers={providersRes.data ?? []}
      coins={coinsRes.data ?? []}
      networks={networksRes.data ?? []}
      returnTo={returnTo}
    />
  )
}
