import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What each vendor's products sold, for settling with them by hand.
 *
 * ⚠️ There is no "owed" figure here and there must not be one. Decision A4:
 * the Owner licenses a product outright and the system never tracks money owed
 * to a vendor; nothing in the schema holds anybody's licence terms. This
 * module reports SALES. What gets paid is the agreement, and it lives outside
 * the software.
 *
 * Read with the service client, like the rest of the Phase 2 admin reads — the
 * function is granted to `service_role` alone and does not re-check the
 * caller, so the `(super)` route group is what decides who may ask. See
 * `lib/admin/data/affiliates.ts` for the same note.
 */

export type VendorSalesRow = {
  vendorId: string
  name: string
  status: string
  /** How many of their products sold at least once in the period. */
  products: number
  units: number
  grossMinor: number
  /** What the same units would have cost at list price. */
  listMinor: number
  refundedUnits: number
  refundedMinor: number
  /** Affiliate commission those sales cost, net of clawbacks. */
  commissionMinor: number
  /** gross − refunded − commission. What the platform kept. */
  netMinor: number
}

export type VendorProductSalesRow = Omit<VendorSalesRow, 'name' | 'status' | 'products'> & {
  productId: string
  title: string
}

export type VendorSalesReport = {
  from: string
  to: string
  vendors: VendorSalesRow[]
  products: VendorProductSalesRow[]
}

const n = (v: unknown) => Number(v ?? 0)

export async function getVendorSalesReport(
  from: Date,
  to: Date,
): Promise<VendorSalesReport> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('admin_vendor_sales_report', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  })

  if (error) {
    /* An operator settling from an empty report would pay nobody and assume
       there was nothing to pay. Fail loudly. */
    throw new Error(`Could not load vendor sales: ${error.message}`)
  }

  const raw = (data ?? {}) as {
    from?: string
    to?: string
    vendors?: Record<string, unknown>[]
    products?: Record<string, unknown>[]
  }

  return {
    from: raw.from ?? from.toISOString(),
    to: raw.to ?? to.toISOString(),
    vendors: (raw.vendors ?? []).map((r) => ({
      vendorId: String(r.vendor_id),
      name: String(r.name ?? ''),
      status: String(r.status ?? ''),
      products: n(r.products),
      units: n(r.units),
      grossMinor: n(r.gross_minor),
      listMinor: n(r.list_minor),
      refundedUnits: n(r.refunded_units),
      refundedMinor: n(r.refunded_minor),
      commissionMinor: n(r.commission_minor),
      netMinor: n(r.net_minor),
    })),
    products: (raw.products ?? []).map((r) => ({
      vendorId: String(r.vendor_id),
      productId: String(r.product_id),
      title: String(r.title ?? ''),
      units: n(r.units),
      grossMinor: n(r.gross_minor),
      listMinor: n(r.list_minor),
      refundedUnits: n(r.refunded_units),
      refundedMinor: n(r.refunded_minor),
      commissionMinor: n(r.commission_minor),
      netMinor: n(r.net_minor),
    })),
  }
}

/**
 * The periods an operator actually settles over.
 *
 * Presets rather than two date pickers: settlement happens per month, and a
 * pair of calendars is four interactions to express "last month". `all` starts
 * at the epoch so it needs no special case downstream.
 */
export type SalesPeriod = 'this_month' | 'last_month' | 'last_90' | 'all'

export function periodRange(period: SalesPeriod, now = new Date()): { from: Date; to: Date } {
  const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))

  switch (period) {
    case 'last_month': {
      const thisMonth = startOfMonth(now)
      const from = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1))
      return { from, to: thisMonth }
    }
    case 'last_90':
      return { from: new Date(now.getTime() - 90 * 86_400_000), to: now }
    case 'all':
      return { from: new Date(0), to: now }
    case 'this_month':
    default:
      return { from: startOfMonth(now), to: now }
  }
}
