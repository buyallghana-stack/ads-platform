import type { Metadata } from 'next'

import { redirect } from '@/i18n/navigation'

export const metadata: Metadata = {
  title: 'Vault Deposit Payment',
  robots: { index: false, follow: false },
}

/**
 * Where a Vault deposit used to come back to, kept as a signpost.
 *
 * Until 18 September 2026 this page confirmed a deposit itself, by asking
 * Paystack directly with this app's own key. That call is gone: deposits go out
 * through the Tech Store hub now and come back to `/payments/return`, which
 * settles either kind of payment and words the result for whichever it was.
 *
 * The route stays because it was a live address, and a bookmark or a redirect
 * still in flight should reach the page that can answer rather than a 404. It
 * carries the reference across untouched: the return page trusts nothing in the
 * URL anyway, it looks the row up and asks the hub.
 *
 * ⚠️ IT IS NOT AN ADDRESS THE HUB MAY USE. The hub's allowlist holds
 * `/payments/return` alone and refuses anything else with a 422, so nothing may
 * point a `return_url` here.
 */
export default async function VaultPaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ reference?: string; trxref?: string; ref?: string }>
}) {
  const { locale } = await params
  const { reference, trxref, ref } = await searchParams

  const carried = reference ?? trxref ?? ref ?? null

  redirect({
    href: carried ? `/payments/return?reference=${encodeURIComponent(carried)}` : '/payments/return',
    locale,
  })
}
