import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export type ManualPaymentRow = {
  kind: 'plan' | 'vault'
  id: string
  reference: string
  /** The plan, or the Vault plan, being bought. */
  planName: string
  /** The CASH that should have arrived on the operator's phone. */
  cashMinor: number
  /** The part already taken from the buyer's balance (0 when none). */
  balanceMinor: number
  currency: string
  buyerName: string
  buyerPhone: string
  senderPhone: string | null
  claimedAt: string | null
  createdAt: string
  /** A signed link, valid for an hour: the bucket is private. */
  proofUrl: string | null
}

type Raw = {
  id: string
  user_id: string
  amount_minor: number
  balance_minor: number | null
  currency_code: string
  created_at: string
  manual_reference: string
  manual_sender_phone: string | null
  manual_proof_path: string | null
  manual_claimed_at: string | null
  tiers?: { name: string } | null
  vault_plans?: { name: string } | null
}

const COLUMNS =
  'id, user_id, amount_minor, balance_minor, currency_code, created_at, manual_reference, manual_sender_phone, manual_proof_path, manual_claimed_at'

/**
 * Manual payments still waiting on the operator, plans and Vault deposits
 * together, the ones the buyer says they have sent first. Unclaimed ones are
 * listed too, so money that arrives before the buyer taps "I have sent it" can
 * still be matched.
 */
export async function getPendingManualPayments(): Promise<ManualPaymentRow[]> {
  const admin = createAdminClient()
  const [plans, vaults] = await Promise.all([
    admin
      .from('subscription_payments')
      .select(`${COLUMNS}, tiers(name)`)
      .eq('status', 'pending')
      .not('manual_reference' as never, 'is', null)
      .limit(200),
    admin
      .from('vault_payments')
      .select(`${COLUMNS}, vault_plans(name)`)
      .eq('status', 'pending')
      .not('manual_reference' as never, 'is', null)
      .limit(200),
  ])

  const rows = [
    ...((plans.data ?? []) as unknown as Raw[]).map((r) => ({ r, kind: 'plan' as const })),
    ...((vaults.data ?? []) as unknown as Raw[]).map((r) => ({ r, kind: 'vault' as const })),
  ]

  const userIds = [...new Set(rows.map(({ r }) => r.user_id))]
  const { data: people } = userIds.length
    ? await admin.from('profiles').select('id, full_name, phone').in('id', userIds)
    : { data: [] }
  const personById = new Map((people ?? []).map((p) => [p.id, p]))

  const paths = rows.map(({ r }) => r.manual_proof_path).filter((p): p is string => Boolean(p))
  const signed = paths.length
    ? ((await admin.storage.from('payment-proofs').createSignedUrls(paths, 3600)).data ?? [])
    : []
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]))

  return rows
    .map(({ r, kind }) => {
      const balanceMinor = Number(r.balance_minor ?? 0)
      return {
        kind,
        id: r.id,
        reference: r.manual_reference,
        planName: (kind === 'vault' ? r.vault_plans?.name : r.tiers?.name) ?? '',
        // A plan row's amount is already the cash part; a Vault row holds the full deposit.
        cashMinor: kind === 'vault' ? r.amount_minor - balanceMinor : r.amount_minor,
        balanceMinor,
        currency: r.currency_code.trim(),
        buyerName: personById.get(r.user_id)?.full_name ?? '',
        buyerPhone: personById.get(r.user_id)?.phone ?? '',
        senderPhone: r.manual_sender_phone,
        claimedAt: r.manual_claimed_at,
        createdAt: r.created_at,
        proofUrl: r.manual_proof_path ? (urlFor.get(r.manual_proof_path) ?? null) : null,
      }
    })
    .sort((a, b) => {
      // Claimed first (oldest claim first), then unclaimed, newest first.
      if (a.claimedAt && b.claimedAt) return a.claimedAt.localeCompare(b.claimedAt)
      if (a.claimedAt) return -1
      if (b.claimedAt) return 1
      return b.createdAt.localeCompare(a.createdAt)
    })
}
