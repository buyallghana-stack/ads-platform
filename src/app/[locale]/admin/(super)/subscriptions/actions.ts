'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getPlans } from '@/lib/admin/data/plans'
import type { PlanRow } from '@/lib/admin/types'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Editing the plans.
 *
 * THESE ARE MONEY WRITES, more directly than they look. `resolve_user_tier`
 * reads these rows live, so raising a plan's `rewardMultiplier` changes what
 * every current holder earns on their very next ad, and lowering
 * `redemptionMinimumPoints` changes what they must reach before they can
 * withdraw. Nothing is retroactive — the ledger keeps the rate it was written
 * with, and a subscription keeps what was paid for it — but everything is
 * immediate.
 *
 * The value-per-cedi rule from migration 037 is checked in the EDITOR and not
 * here, deliberately. It is a warning, not a constraint: a promotional plan is
 * a legitimate thing to want, and an operator who has read the warning is
 * entitled to overrule it. What the server refuses is the set of things that
 * would corrupt data rather than merely be unwise — renaming a slug, making
 * the starting plan cost money, deleting a plan people have bought.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That could not be saved. Please try again.'

const planSchema = z.object({
  id: z.uuid().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]*$/, 'Use lowercase letters, like "gold"'),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).optional(),
  priceGhs: z.number().min(0).max(100_000),
  billingPeriodDays: z.number().int().min(1).max(3650),
  dailyAdCap: z.number().int().min(0).max(10_000),
  rewardMultiplier: z.number().gt(0).max(100),
  redemptionMinimumPoints: z.number().int().min(0),
  referralBonusMultiplier: z.number().gt(0).max(100),
  adPriority: z.number().int().min(0).max(1000),
  adCooldownSeconds: z.number().int().min(0).max(86_400),
  sortOrder: z.number().int().min(0).max(1000),
  /* The top rung's own ceiling. Nullable rather than optional: null is the
     instruction to CLEAR it, which is a different thing from not mentioning
     it, and `admin_save_plan` distinguishes the two by key presence. */
  bandMaxGhs: z.number().min(0).max(1_000_000).nullable().optional(),
  bandMaxMultiplier: z.number().gt(0).max(1000).nullable().optional(),
  /* Optional for the same reason the ceilings are: the RPC honours the key
     when it is present and leaves the flag alone when it is not, so an older
     caller cannot put an announced plan back on sale by omission. */
  comingSoon: z.boolean().optional(),
})

export type PlanInput = z.input<typeof planSchema>

export type PlanResult =
  | { ok: true; plans?: PlanRow[]; outcome?: 'deleted' | 'hidden' }
  | { ok: false; message: string; plans?: PlanRow[] }

export async function savePlan(input: PlanInput): Promise<PlanResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = planSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? GENERIC }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_save_plan', {
    p_admin_id: user.id,
    p_plan: { ...parsed.data, id: parsed.data.id ?? null },
  })

  if (error) return { ok: false, message: humanise(error.message), plans: await safePlans() }

  revalidatePath('/admin/subscriptions')
  // The upgrade screen and the plan figures on the overview both read tiers.
  revalidatePath('/admin')
  revalidatePath('/upgrade')

  return { ok: true, plans: await safePlans() }
}

export async function setPlanVisibility(id: string, live: boolean): Promise<PlanResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (!z.uuid().safeParse(id).success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_set_plan_visibility', {
    p_admin_id: user.id,
    p_plan_id: id,
    p_active: live,
  })

  if (error) return { ok: false, message: humanise(error.message), plans: await safePlans() }

  revalidatePath('/admin/subscriptions')
  revalidatePath('/upgrade')

  return { ok: true, plans: await safePlans() }
}

/**
 * Announced, or on sale.
 *
 * ⚠️ THIS IS NOT A WAY TO HIDE A PLAN, and the difference is load bearing. A
 * coming soon plan stays in the ladder, so the plan below it keeps the band
 * and the rate it has today. Hiding one instead moves both, silently, for
 * everybody who buys the rung underneath.
 *
 * It does nothing to a subscription already paid for: `resolve_user_tier`
 * reads the tier row, not this flag, so existing holders keep what they bought
 * until it expires. What stops is new purchases.
 */
export async function setPlanComingSoon(id: string, comingSoon: boolean): Promise<PlanResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (!z.uuid().safeParse(id).success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_set_plan_coming_soon', {
    p_admin_id: user.id,
    p_plan_id: id,
    p_coming_soon: comingSoon,
  })

  if (error) return { ok: false, message: humanise(error.message), plans: await safePlans() }

  revalidatePath('/admin/subscriptions')
  revalidatePath('/upgrade')
  // The landing page quotes the ladder, and it must not advertise a rate that
  // has just stopped being purchasable.
  revalidatePath('/')

  return { ok: true, plans: await safePlans() }
}

export async function deletePlan(id: string): Promise<PlanResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (!z.uuid().safeParse(id).success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_delete_plan', {
    p_admin_id: user.id,
    p_plan_id: id,
  })

  if (error) return { ok: false, message: humanise(error.message), plans: await safePlans() }

  revalidatePath('/admin/subscriptions')
  revalidatePath('/upgrade')

  // 'hidden' rather than 'deleted' when somebody has bought it — say which
  // happened instead of claiming a delete the database declined to do.
  return {
    ok: true,
    plans: await safePlans(),
    outcome: (data as unknown as 'deleted' | 'hidden') ?? 'deleted',
  }
}

/* ------------------------------------------------------------------ */

async function safePlans(): Promise<PlanRow[] | undefined> {
  try {
    return await getPlans()
  } catch {
    return undefined
  }
}

function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return GENERIC
  }
  return clean
}
