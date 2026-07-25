import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Read side of 2FA. `get_totp_status` is the one function in migration 031
 * granted to authenticated, because what it returns carries no secret and no
 * hash — only whether the factor is on and how many codes are left. Reading it
 * through the RLS user client keeps it self-scoped by `auth.uid()`.
 */
export type TwoFactorStatus = {
  enabled: boolean
  pending: boolean
  confirmedAt: string | null
  backupCodesRemaining: number
  backupCodesTotal: number
}

const EMPTY: TwoFactorStatus = {
  enabled: false,
  pending: false,
  confirmedAt: null,
  backupCodesRemaining: 0,
  backupCodesTotal: 0,
}

export const getTwoFactorStatus = cache(async (): Promise<TwoFactorStatus> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_totp_status')
  if (error || !data) return EMPTY

  const row = data as Record<string, unknown>
  return {
    enabled: Boolean(row.enabled),
    pending: Boolean(row.pending),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    backupCodesRemaining: Number(row.backup_codes_remaining ?? 0),
    backupCodesTotal: Number(row.backup_codes_total ?? 0),
  }
})
