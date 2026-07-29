import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { Advertiser, AdvertiserPayment } from '../types'

/**
 * Advertiser contracts and the money against them, for real.
 *
 * Until migration 055 there was no backend here of any kind — no table, no
 * functions — and `ads.advertiser_name` was a free-text reporting label. That
 * gap is why Overview and Finance were showing invented deposits: the figure
 * is defined as subscriptions plus advertiser contracts, and advertiser
 * contracts had nowhere to exist.
 *
 * Reads go through the user's own client, as everywhere else in the admin
 * area: `admin_list_advertisers` re-checks `is_admin()` for a non-null caller,
 * so it answers to the same predicate that guards the tables themselves.
 */

/** One row as `admin_list_advertisers` returns it. */
type AdvertiserRow = {
  id: string
  name: string
  contact: string | null
  status: 'pending' | 'active' | 'ended'
  paid_ghs: number | string
  spent_ghs: number | string
  ads_live: number
  ads_total: number
  payments: number
  last_paid_at: string | null
  started_at: string
  ends_at: string | null
  notes: string | null
}

type PaymentRow = {
  id: string
  amount_ghs: number | string
  received_at: string
  method: string | null
  reference: string | null
  note: string | null
  recorded_by: string | null
}

export async function getAdvertisers(): Promise<Advertiser[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_advertisers')

  if (error) throw new Error(`Could not load advertisers: ${error.message}`)

  return ((data ?? []) as unknown as AdvertiserRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    status: row.status,
    // numeric arrives as a string over PostgREST. Converted once here so no
    // screen ever does string arithmetic on a contract value.
    contractGhs: Number(row.paid_ghs),
    spentGhs: Number(row.spent_ghs),
    adsLive: row.ads_live,
    adsTotal: row.ads_total,
    payments: row.payments,
    lastPaidAt: row.last_paid_at,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    notes: row.notes,
  }))
}

/**
 * One advertiser's receipts, for the review panel.
 *
 * Fetched only when a panel opens rather than shipped with every row: most
 * advertisers are opened rarely, and a list screen does not need every
 * bank reference in the business sitting in its payload.
 */
export async function getAdvertiserPayments(advertiserId: string): Promise<AdvertiserPayment[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_advertiser_payments', {
    p_advertiser_id: advertiserId,
  })

  if (error) throw new Error(`Could not load payments: ${error.message}`)

  return ((data ?? []) as unknown as PaymentRow[]).map((row) => ({
    id: row.id,
    amountGhs: Number(row.amount_ghs),
    receivedAt: row.received_at,
    method: row.method,
    reference: row.reference,
    note: row.note,
    recordedBy: row.recorded_by,
  }))
}
