'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getAdvertiserPayments, getAdvertisers } from '@/lib/admin/data/advertisers'
import type { Advertiser, AdvertiserPayment } from '@/lib/admin/types'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Advertiser contracts and the receipts against them.
 *
 * Same rules as every other admin write: the acting admin comes from the
 * verified session and never from the payload, the service client is used
 * because these functions are revoked from `authenticated`, and the refreshed
 * list comes back so the screen renders what the database did rather than
 * what the form predicted.
 *
 * MONEY IS TAKEN AS A STRING AND CONVERTED TO INTEGER PESEWAS HERE.
 * `parseFloat('12.30') * 100` is 1229.9999999999998, and rounding that in
 * four different places is how a statement stops reconciling by a pesewa at a
 * time. It is parsed once, from the text the operator typed, and everything
 * downstream is a bigint.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That could not be saved. Please try again.'

const advertiserSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'active', 'ended']),
  startedAt: z.string().min(1),
  endsAt: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
})

export type AdvertiserInput = z.input<typeof advertiserSchema>

export type AdvertiserResult =
  | { ok: true; advertisers?: Advertiser[] }
  | { ok: false; message: string; advertisers?: Advertiser[] }

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

export async function saveAdvertiser(input: AdvertiserInput): Promise<AdvertiserResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = advertiserSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Check the name and dates, then try again.' }
  const a = parsed.data

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_advertiser', {
    p_admin_id: user.id,
    p_advertiser: {
      id: a.id ?? null,
      name: a.name,
      contact: a.contact ?? null,
      status: a.status,
      startedAt: a.startedAt,
      // An empty string must reach the database as null, not as an unparseable
      // timestamp: "no end date" is the normal case for these contracts.
      endsAt: a.endsAt?.trim() ? a.endsAt : null,
      notes: a.notes ?? null,
    },
  })

  if (error) return { ok: false, message: humanise(error.message), advertisers: await safeList() }

  revalidatePath('/admin/advertisers')
  revalidatePath('/admin')
  revalidatePath('/admin/finance')

  return { ok: true, advertisers: await safeList() }
}

export async function deleteAdvertiser(
  id: string,
): Promise<AdvertiserResult & { outcome?: 'deleted' | 'ended' }> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  if (!z.uuid().safeParse(id).success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_delete_advertiser', {
    p_admin_id: user.id,
    p_advertiser_id: id,
  })

  if (error) return { ok: false, message: humanise(error.message), advertisers: await safeList() }

  revalidatePath('/admin/advertisers')
  revalidatePath('/admin')

  // 'ended' rather than 'deleted' when receipts exist — the caller says which
  // happened instead of claiming a delete that the database declined to do.
  return {
    ok: true,
    advertisers: await safeList(),
    outcome: (data as unknown as 'deleted' | 'ended') ?? 'deleted',
  }
}

/* ------------------------------------------------------------------ */
/* Receipts                                                            */
/* ------------------------------------------------------------------ */

const paymentSchema = z.object({
  advertiserId: z.uuid(),
  /* Typed money, validated as text. Up to two decimal places and nothing
     else — "12.345" is a slip worth catching before it becomes 1234 pesewas
     with the 5 silently gone. */
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 2500 or 2500.50'),
  receivedAt: z.string().min(1),
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
})

export type PaymentInput = z.input<typeof paymentSchema>

export type PaymentResult =
  | { ok: true; advertisers?: Advertiser[]; payments?: AdvertiserPayment[] }
  | { ok: false; message: string }

export async function recordAdvertiserPayment(input: PaymentInput): Promise<PaymentResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = paymentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? GENERIC }
  }
  const p = parsed.data

  const minor = toMinor(p.amount)
  if (minor <= 0) return { ok: false, message: 'A payment needs an amount.' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_record_advertiser_payment', {
    p_admin_id: user.id,
    p_advertiser_id: p.advertiserId,
    p_amount_minor: minor,
    p_received_at: p.receivedAt,
    p_method: p.method?.trim() || undefined,
    p_reference: p.reference?.trim() || undefined,
    p_note: p.note?.trim() || undefined,
  })

  if (error) return { ok: false, message: humanise(error.message) }

  revalidatePath('/admin/advertisers')
  revalidatePath('/admin')
  revalidatePath('/admin/finance')

  return {
    ok: true,
    advertisers: await safeList(),
    payments: await safePayments(p.advertiserId),
  }
}

export async function deleteAdvertiserPayment(
  paymentId: string,
  advertiserId: string,
): Promise<PaymentResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  if (!z.uuid().safeParse(paymentId).success || !z.uuid().safeParse(advertiserId).success) {
    return { ok: false, message: GENERIC }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_delete_advertiser_payment', {
    p_admin_id: user.id,
    p_payment_id: paymentId,
  })

  if (error) return { ok: false, message: humanise(error.message) }

  revalidatePath('/admin/advertisers')
  revalidatePath('/admin')
  revalidatePath('/admin/finance')

  return {
    ok: true,
    advertisers: await safeList(),
    payments: await safePayments(advertiserId),
  }
}

/** The receipts behind one advertiser, loaded when their panel opens. */
export async function loadAdvertiserPayments(
  advertiserId: string,
): Promise<AdvertiserPayment[] | null> {
  const user = await getSessionUser()
  if (!user) return null
  if (!z.uuid().safeParse(advertiserId).success) return null
  return (await safePayments(advertiserId)) ?? null
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * "2500.5" → 250050 pesewas, by string, never by float.
 *
 * The regex above has already guaranteed the shape, so this is a split and a
 * pad rather than a parse — no rounding, no binary representation, nothing to
 * drift by a pesewa.
 */
function toMinor(amount: string): number {
  const [whole, fraction = ''] = amount.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

async function safeList(): Promise<Advertiser[] | undefined> {
  try {
    return await getAdvertisers()
  } catch {
    return undefined
  }
}

async function safePayments(id: string): Promise<AdvertiserPayment[] | undefined> {
  try {
    return await getAdvertiserPayments(id)
  } catch {
    return undefined
  }
}

/**
 * These are raised for an operator to read — "There is already an advertiser
 * called MTN Ghana", "That payment date is in the future" — so they are shown
 * as-is. What is filtered out is the machinery.
 */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return GENERIC
  }
  return clean
}
