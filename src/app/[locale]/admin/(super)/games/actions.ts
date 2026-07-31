'use server'

import { revalidatePath } from 'next/cache'

import type { GameKind } from '@/lib/games/types'
import { GAME_KINDS } from '@/lib/games/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { actingSuperAdminId } from '@/lib/admin/roles'

/**
 * Admin writes for the games.
 *
 * The acting admin's id comes from the verified session, never the payload;
 * `assert_admin` inside each function is the check, because these run through
 * the service client where `auth.uid()` is null.
 */
export type SaveResult = { ok: true; saved: number } | { ok: false; message: string }

/* Shared, since 2026-07-31. Five copies of this asked for the literal
   role 'admin' and all five went quiet when that row was renamed. */
const actingAdmin = actingSuperAdminId

export type PrizeInput = {
  id: string | null
  slot: number
  label: string
  points: number
  extra_plays: number
  weight: number
  colour: string
  daily_cap: number
  weekly_cap: number
  is_active: boolean
}

export async function saveGamePrizes(
  game: GameKind,
  prizes: PrizeInput[],
): Promise<SaveResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }
  if (!GAME_KINDS.includes(game)) return { ok: false, message: 'Unknown game' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_save_game_prizes', {
    p_admin_id: adminId,
    p_game: game,
    p_prizes: prizes,
  })

  if (error) {
    /* Raised in operator language by the database — including the "every
       outcome must pay something" constraint, which is the one an operator is
       most likely to trip. Surfaced verbatim rather than reworded. */
    return { ok: false, message: error.message }
  }

  revalidatePath('/admin/games')
  return { ok: true, saved: Number(data ?? 0) }
}

export async function setTierPlays(tierId: string, plays: number): Promise<SaveResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_set_tier_game_plays', {
    p_admin_id: adminId,
    p_tier_id: tierId,
    p_plays: plays,
  })

  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/games')
  return { ok: true, saved: Number(data ?? 0) }
}
