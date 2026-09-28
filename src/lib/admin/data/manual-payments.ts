import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type ManualPaymentRow = {
  id: string
  reference: string
  planName: string
  amountMinor: number
  currency: string
  buyerName: string
  buyerPhone: string
  senderName: string | null
  senderPhone: string | null
  claimedAt: string | null
  createdAt: string
  /** A signed link, valid for an hour: the bucket is private. */
  proofUrl: string | null
}

/**
 * Manual payments still waiting on the operator, the ones the buyer says they
 * have sent first. Unclaimed ones are listed too, below, so an operator who
 * sees money arrive before the buyer taps "I have sent it" can still find it.
 */
export async function getPendingManualPayments(): Promise<ManualPaymentRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscription_payments')
    .select(
      'id, amount_minor, currency_code, created_at, manual_reference, manual_sender_name, manual_sender_phone, manual_proof_path, manual_claimed_at, user_id, tiers(name)',
    )
    .eq('status', 'pending')
    .not('manual_reference' as never, 'is', null)
    .order('manual_claimed_at' as never, { ascending: true, nullsFirst: false })
    .limit(200)

  const rows = (data ?? []) as unknown as {
    id: string
    amount_minor: number
    currency_code: string
    created_at: string
    manual_reference: string
    manual_sender_name: string | null
    manual_sender_phone: string | null
    manual_proof_path: string | null
    manual_claimed_at: string | null
    user_id: string
    tiers: { name: string } | null
  }[]

  const userIds = [...new Set(rows.map((r) => r.user_id))]
  const { data: people } = userIds.length
    ? await admin.from('profiles').select('id, full_name, phone').in('id', userIds)
    : { data: [] }
  const personById = new Map((people ?? []).map((p) => [p.id, p]))

  const paths = rows.map((r) => r.manual_proof_path).filter((p): p is string => Boolean(p))
  const signed = paths.length
    ? (await admin.storage.from('payment-proofs').createSignedUrls(paths, 3600)).data ?? []
    : []
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]))

  return rows.map((r) => ({
    id: r.id,
    reference: r.manual_reference,
    planName: r.tiers?.name ?? '',
    amountMinor: r.amount_minor,
    currency: r.currency_code,
    buyerName: personById.get(r.user_id)?.full_name ?? '',
    buyerPhone: personById.get(r.user_id)?.phone ?? '',
    senderName: r.manual_sender_name,
    senderPhone: r.manual_sender_phone,
    claimedAt: r.manual_claimed_at,
    createdAt: r.created_at,
    proofUrl: r.manual_proof_path ? (urlFor.get(r.manual_proof_path) ?? null) : null,
  }))
}
