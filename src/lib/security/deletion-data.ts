import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Read side of account deletion. `get_deletion_status` is self-scoped by
 * `auth.uid()` and carries nothing sensitive, so it is read through the RLS
 * user client like the other status reads.
 */
export type DeletionStatus = {
  pending: boolean
  requestedAt: string | null
  effectiveAt: string | null
  daysLeft: number | null
}

const EMPTY: DeletionStatus = {
  pending: false,
  requestedAt: null,
  effectiveAt: null,
  daysLeft: null,
}

export const getDeletionStatus = cache(async (): Promise<DeletionStatus> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_deletion_status')
  if (error || !data) return EMPTY

  const row = data as Record<string, unknown>
  return {
    pending: Boolean(row.pending),
    requestedAt: (row.requested_at as string | null) ?? null,
    effectiveAt: (row.effective_at as string | null) ?? null,
    daysLeft: row.days_left == null ? null : Number(row.days_left),
  }
})
