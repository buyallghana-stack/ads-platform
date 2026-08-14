'use server'

import { revalidatePath } from 'next/cache'

import { actingSuperAdminId } from '@/lib/admin/roles'
import { getCouponRedemptions, type CouponRedemptionRow } from '@/lib/admin/data/coupons'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Coupon actions.
 *
 * Through the service client with the acting admin's id, because
 * `admin_save_coupon` asserts on `p_admin_id`. The id comes from the verified
 * session and never from the payload.
 *
 * ⚠️ EVERY RULE IS RE-CHECKED IN SQL. The form below refuses an ads coupon
 * with no plan, and so does the function, and so does a check constraint. That
 * is not belt and braces for its own sake: a coupon that names no target
 * cannot be used at all (the operator's rule), and an admin's browser is still
 * a client.
 */
export type CouponActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type SaveCouponInput = {
  id?: string | null
  code: string
  business: 'ads' | 'affiliate'
  tierId?: string | null
  productId?: string | null
  discountKind: 'percent' | 'fixed'
  /** Percent coupons only. */
  percent?: number | null
  /** Fixed coupons only, in minor units. The form collects cedis. */
  amountMinor?: number | null
  maxDiscountMinor?: number | null
  minSpendMinor?: number | null
  quota: number
  perUserLimit: number
  firstPurchaseOnly: boolean
  startsAt?: string | null
  endsAt?: string | null
  isActive: boolean
  note?: string | null
}

export async function saveCoupon(input: SaveCouponInput): Promise<CouponActionResult> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()

  /* ⚠️ EVERY ARGUMENT IS SENT, AS `null` RATHER THAN `undefined`, AND THAT IS
     NOT TIDINESS. PostgREST picks an overload from the exact SET OF ARGUMENT
     NAMES in the request, and supabase-js drops keys whose value is
     `undefined`. `admin_save_coupon` declares eighteen parameters and none of
     them has a default, so omitting seven produced
     "Could not find the function public.admin_save_coupon(…) in the schema
     cache" — a message about a function that plainly exists, from a save that
     typechecked. Elsewhere in this codebase `?? undefined` is safe because
     those functions give their optional parameters SQL defaults. This one does
     not, deliberately: a default on a money field is a value nobody chose. */
  const { error } = await admin.rpc('admin_save_coupon', {
    p_admin_id: adminId,
    p_id: (input.id ?? null) as unknown as string,
    p_code: input.code,
    p_business: input.business,
    p_tier_id: (input.business === 'ads' ? (input.tierId ?? null) : null) as unknown as string,
    p_product_id: (input.business === 'affiliate' ? (input.productId ?? null) : null) as unknown as string,
    p_discount_kind: input.discountKind,
    p_percent: (input.discountKind === 'percent' ? (input.percent ?? null) : null) as unknown as number,
    p_amount_minor: (input.discountKind === 'fixed' ? (input.amountMinor ?? null) : null) as unknown as number,
    p_max_discount_minor:
      (input.discountKind === 'percent' ? (input.maxDiscountMinor ?? null) : null) as unknown as number,
    p_min_spend_minor: input.minSpendMinor ?? 0,
    p_quota: input.quota,
    p_per_user_limit: input.perUserLimit,
    p_first_purchase_only: input.firstPurchaseOnly,
    p_starts_at: (input.startsAt || null) as unknown as string,
    p_ends_at: (input.endsAt || null) as unknown as string,
    p_is_active: input.isActive,
    p_note: (input.note ?? null) as unknown as string,
  })

  /* Surfaced verbatim. Every refusal in `admin_save_coupon` is already written
     in operator language, including the commission guard, which names the
     exact percentage the code may not exceed. Rewording it here would lose the
     number. */
  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/coupons')
  return { ok: true, data: undefined }
}

export async function deleteCoupon(id: string): Promise<CouponActionResult> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_delete_coupon', { p_admin_id: adminId, p_id: id })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/admin/coupons')
  return { ok: true, data: undefined }
}

/**
 * Who used a code, loaded when the operator opens a row rather than with the
 * page. A promotion with a quota of a thousand has a thousand of these, and
 * the list screen needs none of them.
 */
export async function loadCouponRedemptions(
  couponId: string,
): Promise<CouponActionResult<CouponRedemptionRow[]>> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return { ok: false, message: 'Not an administrator' }

  return { ok: true, data: await getCouponRedemptions(couponId) }
}
