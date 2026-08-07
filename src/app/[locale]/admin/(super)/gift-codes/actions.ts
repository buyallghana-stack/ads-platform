'use server'

import { revalidatePath } from 'next/cache'

import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'
import { actingSuperAdminId } from '@/lib/admin/roles'

/**
 * Admin gift-code actions.
 *
 * All three run through the service client, and all three pass the acting
 * admin's id explicitly: these functions are called where `auth.uid()` is
 * null, so `assert_admin(p_admin_id)` inside them is the check, exactly as
 * `admin_save_ad` and `admin_set_config` do it.
 *
 * The id comes from the verified session, never from the payload.
 */
export type CodeActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string }

/* Shared, since 2026-07-31. Five copies of this asked for the literal
   role 'admin' and all five went quiet when that row was renamed. */
const actingAdmin = actingSuperAdminId

/**
 * A code the form can display while the operator types the points value.
 *
 * Creates NOTHING. The operator asked for generation and the points field to
 * work "parallel just like entering values for a form", so the code appears
 * as soon as the form opens and the row is written only on save — abandoning
 * the form leaves no orphan code behind.
 */
export async function newCodeCandidate(): Promise<CodeActionResult<string>> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_gift_code')
  if (error || !data) {
    reportUnexpected(error, 'admin.gift-codes.generate')
    return { ok: false, message: error?.message ?? 'Could not generate a code' }
  }
  return { ok: true, data }
}

export async function createGiftCode(input: {
  code: string
  points: number
  note?: string
  expiresAt?: string | null
}): Promise<CodeActionResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_create_gift_code', {
    p_admin_id: adminId,
    p_code: input.code,
    p_points: input.points,
    p_note: input.note ?? undefined,
    p_expires_at: input.expiresAt || undefined,
  })

  if (error) {
    // The function raises in operator language ("Set how many points this
    // code is worth"), so it is surfaced verbatim rather than reworded.
    return { ok: false, message: error.message }
  }

  revalidatePath('/admin/gift-codes')
  return { ok: true, data: undefined }
}

export async function revokeGiftCode(codeId: string): Promise<CodeActionResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_revoke_gift_code', {
    p_admin_id: adminId,
    p_code_id: codeId,
  })

  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/gift-codes')
  return { ok: true, data: undefined }
}

/* ------------------------------------------------------------------ */
/* COMMISSION gift codes — the affiliate business, paying cedis        */
/* ------------------------------------------------------------------ */

/**
 * The same three actions against the commission tables.
 *
 * ⚠️ SEPARATE FUNCTIONS, NOT A `business` ARGUMENT. D27: no shared table and
 * no shared function between the two businesses. The amount here is MINOR
 * UNITS OF CEDIS and above it is POINTS, and those are not the same number
 * with a different label — one is worth a hundredth of the other. A single
 * pair of actions taking a discriminator is one missed branch away from
 * creating a GHS 500 voucher where somebody meant 500 points.
 */

export async function newCommissionCodeCandidate(): Promise<CodeActionResult<string>> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_commission_gift_code')
  if (error || !data) {
    reportUnexpected(error, 'admin.commission-gift-codes.generate')
    return { ok: false, message: error?.message ?? 'Could not generate a code' }
  }
  return { ok: true, data }
}

export async function createCommissionGiftCode(input: {
  code: string
  /** Minor units. The form collects cedis and converts once, at the edge. */
  amountMinor: number
  note?: string
  expiresAt?: string | null
}): Promise<CodeActionResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_create_commission_gift_code', {
    p_admin_id: adminId,
    p_code: input.code,
    p_amount_minor: input.amountMinor,
    p_note: input.note ?? undefined,
    p_expires_at: input.expiresAt || undefined,
  })

  if (error) return { ok: false, message: error.message }

  /* The RPC answers with an outcome rather than raising, so a refusal that
     never touched the database still has to be reported as one. */
  const outcome = (data as { outcome?: string } | null)?.outcome
  if (outcome === 'duplicate') return { ok: false, message: 'That code already exists' }
  if (outcome === 'bad_amount') return { ok: false, message: 'Set what this code is worth' }
  if (outcome !== 'ok') return { ok: false, message: 'Could not create the code' }

  revalidatePath('/admin/gift-codes')
  return { ok: true, data: undefined }
}

export async function revokeCommissionGiftCode(codeId: string): Promise<CodeActionResult> {
  const adminId = await actingAdmin()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_revoke_commission_gift_code', {
    p_admin_id: adminId,
    p_code_id: codeId,
  })

  if (error) return { ok: false, message: error.message }

  const outcome = (data as { outcome?: string } | null)?.outcome
  if (outcome === 'already_used') {
    return { ok: false, message: 'That code has been redeemed and cannot be revoked' }
  }
  if (outcome !== 'ok') return { ok: false, message: 'Could not revoke the code' }

  revalidatePath('/admin/gift-codes')
  return { ok: true, data: undefined }
}
