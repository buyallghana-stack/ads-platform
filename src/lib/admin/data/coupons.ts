import 'server-only'

import { actingSuperAdminId } from '@/lib/admin/roles'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Coupon codes for the admin screen.
 *
 * Read through the SERVICE client with the acting admin's id, the way every
 * function that takes `p_admin_id` is called in this codebase, because
 * `admin_list_coupons` asserts on that argument rather than reading
 * `auth.uid()`. See the note in `gift-codes.ts` for why the two conventions
 * both exist.
 */
export type CouponRow = {
  id: string
  code: string
  business: 'ads' | 'affiliate'
  /** The plan or the programme it applies to. A coupon always has one. */
  targetName: string | null
  tierId: string | null
  productId: string | null
  discountKind: 'percent' | 'fixed'
  percent: number | null
  amountMinor: number | null
  maxDiscountMinor: number | null
  minSpendMinor: number
  quota: number
  /** Confirmed redemptions plus checkouts still holding a place. */
  used: number
  perUserLimit: number
  firstPurchaseOnly: boolean
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
  note: string | null
  createdAt: string
  /** What the promotion has cost, counting only money that completed. */
  discountGivenMinor: number
  /** And what it brought in. A quota alone cannot answer "was it worth it". */
  revenueMinor: number
}

/* bigint and numeric arrive as strings over PostgREST once large enough, so
   every money field is coerced here rather than at each place it is read. */
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function getCoupons(): Promise<CouponRow[]> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_coupons', { p_admin_id: adminId })
  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    business: r.business as CouponRow['business'],
    targetName: (r.target_name as string | null) ?? null,
    tierId: (r.tier_id as string | null) ?? null,
    productId: (r.product_id as string | null) ?? null,
    discountKind: r.discount_kind as CouponRow['discountKind'],
    percent: num(r.percent),
    amountMinor: num(r.amount_minor),
    maxDiscountMinor: num(r.max_discount_minor),
    minSpendMinor: Number(r.min_spend_minor ?? 0),
    quota: Number(r.quota),
    used: Number(r.used ?? 0),
    perUserLimit: Number(r.per_user_limit ?? 1),
    firstPurchaseOnly: Boolean(r.first_purchase_only),
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    isActive: Boolean(r.is_active),
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at),
    discountGivenMinor: Number(r.discount_given_minor ?? 0),
    revenueMinor: Number(r.revenue_minor ?? 0),
  }))
}

export type CouponRedemptionRow = {
  id: string
  person: string | null
  email: string
  listMinor: number
  discountMinor: number
  chargedMinor: number
  status: string | null
  createdAt: string
}

export async function getCouponRedemptions(couponId: string): Promise<CouponRedemptionRow[]> {
  const adminId = await actingSuperAdminId()
  if (!adminId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_coupon_redemptions', {
    p_admin_id: adminId,
    p_coupon_id: couponId,
  })
  if (error || !data) return []

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    person: (r.person as string | null) ?? null,
    email: String(r.email),
    listMinor: Number(r.list_minor),
    discountMinor: Number(r.discount_minor),
    chargedMinor: Number(r.charged_minor),
    status: (r.status as string | null) ?? null,
    createdAt: String(r.created_at),
  }))
}

/**
 * What a coupon can point at.
 *
 * A coupon with no target cannot exist, so the form has to offer the real
 * list rather than a free text field. Plans carry their band so the form can
 * say what a percentage is worth at the floor and at the ceiling, which is the
 * number the operator is actually deciding.
 */
export type CouponTarget = {
  id: string
  label: string
  business: 'ads' | 'affiliate'
  priceMinor: number
  /** Only plans have one: the top of the band. */
  bandMaxMinor: number | null
  commissionPercent: number | null
}

export async function getCouponTargets(): Promise<CouponTarget[]> {
  const supabase = createAdminClient()

  const { data: tiers } = await supabase
    .from('tiers')
    .select('id, name, price_minor, band_max_minor, is_default, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order')

  const plans: CouponTarget[] = ((tiers ?? []) as Array<Record<string, unknown>>)
    /* The free plan is not buyable, so a code for it could never be redeemed.
       Offering it would be offering a coupon that does nothing. */
    .filter((t) => !t.is_default && Number(t.price_minor) > 0)
    .map((t) => ({
      id: String(t.id),
      label: String(t.name),
      business: 'ads' as const,
      priceMinor: Number(t.price_minor),
      bandMaxMinor: t.band_max_minor === null ? null : Number(t.band_max_minor),
      commissionPercent: null,
    }))

  return plans
}
