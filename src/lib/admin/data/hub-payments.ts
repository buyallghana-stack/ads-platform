import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * What the payment hub has done to this app's money.
 *
 * Two reads, because an admin arrives with two different questions, and the
 * second one is the reason this screen exists at all.
 *
 * `getHubPayments` is the ordinary view: who bought what, and did it complete.
 *
 * `getHubFlags` is everything that arrived and was NOT acted on. When the hub
 * reports an amount that disagrees with the order, fulfilment refuses, the
 * event is recorded as `mismatch`, and the hub is told 2xx so it stops
 * retrying — all correct, and until this screen existed, completely silent.
 * A flagged event is money that moved at the provider and did not move here.
 *
 * ONE CLIENT, AND IT IS THE ADMIN'S OWN. Both RPCs are SECURITY DEFINER with
 * an `is_admin()` re-check for a non-null caller, the same split
 * `payouts.ts` uses. The service key is for what a browser token must never be
 * able to ask for; a list of payments an admin may already read is not that.
 */

export type HubPaymentStatus = 'pending' | 'confirmed' | 'failed' | 'refunded'

export type HubPayment = {
  id: string
  userId: string
  person: string
  email: string
  tierName: string
  amountMinor: number
  currency: string
  status: HubPaymentStatus
  reference: string
  failureReason: string | null
  createdAt: string
  confirmedAt: string | null
  lastEvent: string | null
  lastResult: string | null
  lastDetail: string | null
  lastEventAt: string | null
  eventCount: number
}

export type HubFlag = {
  id: string
  requestId: string
  event: string
  reference: string
  amountMinor: number | null
  currency: string | null
  result: string
  detail: string | null
  receivedAt: string
  paymentId: string | null
  person: string | null
}

export async function getHubPayments(limit = 100): Promise<HubPayment[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_list_hub_payments', { p_limit: limit })

  /*
    An empty table and a failed read look identical on screen, and on this
    screen that matters more than most: "no flagged payments" is the answer an
    admin acts on by doing nothing. Throwing means a broken read shows as a
    broken page instead of as good news.
  */
  if (error) throw new Error('Could not read hub payments: ' + error.message)

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    person: row.person ?? 'Deleted user',
    email: row.email ?? '',
    tierName: row.tier_name,
    amountMinor: Number(row.amount_minor),
    currency: row.currency_code.trim(),
    status: row.status as HubPaymentStatus,
    reference: row.hub_reference,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    lastEvent: row.last_event,
    lastResult: row.last_result,
    lastDetail: row.last_detail,
    lastEventAt: row.last_event_at,
    eventCount: Number(row.event_count),
  }))
}

export async function getHubFlags(limit = 100): Promise<HubFlag[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_list_hub_flags', { p_limit: limit })

  if (error) throw new Error('Could not read hub flags: ' + error.message)

  return (data ?? []).map((row) => ({
    id: row.id,
    requestId: row.request_id,
    event: row.event,
    reference: row.hub_reference,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    currency: row.currency_code ? row.currency_code.trim() : null,
    result: row.result,
    detail: row.detail,
    receivedAt: row.received_at,
    paymentId: row.payment_id,
    person: row.person,
  }))
}
