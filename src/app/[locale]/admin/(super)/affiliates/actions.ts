'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getViewAsSession } from '@/lib/admin/view-as'
import {
  getAffiliates,
  getCommissionPayouts,
  type AffiliateRow,
  type CommissionPayout,
} from '@/lib/admin/data/affiliates'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Decisions on the affiliate business: commission withdrawals, and whether
 * somebody may go on selling.
 *
 * Written against the same contract as `payouts/actions.ts` — deliberately the
 * same shape, deliberately not the same file. The two queues pay different
 * money out of different ledgers under different switches, and a single module
 * with a `kind` parameter is how one business's rules end up applied to the
 * other's money (D27).
 *
 * ── WHO IS ACTING COMES FROM THE SESSION, NEVER THE PAYLOAD ──
 *
 * A server action is a public HTTP endpoint, so anything the browser says
 * about who is deciding is a claim. `decide_commission_payout`,
 * `mark_commission_payout_paid` and `admin_set_affiliate_status` all take the
 * acting admin's id and call `assert_admin` themselves — which is SUPER admin
 * only, so money fails closed even if a screen were ever mounted in the wrong
 * route group.
 *
 * The service client is used because all three are revoked from
 * `authenticated`: a signed-in browser token cannot approve commission under
 * any circumstances, and that is the property worth having.
 *
 * ── AND NOT WHILE VIEWING SOMEBODY ELSE'S ACCOUNT ──
 *
 * Every write here refuses while a "view as user" session is open. Reads
 * render the viewed account so that feature works; a write that moves money
 * must never be attributable to the wrong person.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That decision could not be recorded. Please try again.'
const WHILE_VIEWING = 'Close the account you are viewing before deciding on money.'

/**
 * Both lists come back on every decision.
 *
 * Costs one extra read on an action a human just took, and buys the same two
 * things the points queue gets from it: the table shows what the DATABASE says
 * happened rather than what the UI predicted, and a second operator's work in
 * another tab surfaces instead of being silently overwritten. Suspending an
 * affiliate can also change the queue — a suspended account cannot file — so
 * both are refreshed by every action rather than only the list that was
 * touched.
 */
export type AffiliateActionResult =
  | { ok: true; payouts?: CommissionPayout[]; affiliates?: AffiliateRow[] }
  | { ok: false; message: string; payouts?: CommissionPayout[]; affiliates?: AffiliateRow[] }

const decisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional(),
})

const paidSchema = z.object({
  id: z.uuid(),
  /** Proof the transfer happened — a MoMo id, a transaction hash. */
  reference: z.string().min(3).max(200),
})

const statusSchema = z.object({
  affiliateId: z.uuid(),
  status: z.enum(['active', 'suspended']),
  reason: z.string().max(1000).optional(),
})

/* ------------------------------------------------------------------ */
/* Approve or reject a withdrawal                                      */
/* ------------------------------------------------------------------ */

export async function decideCommissionPayout(
  input: z.infer<typeof decisionSchema>,
): Promise<AffiliateActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (await getViewAsSession()) return { ok: false, message: WHILE_VIEWING }

  const parsed = decisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }
  const { id, decision, note } = parsed.data

  /* The database refuses a reasonless rejection too. Asking here means the
     operator is told before the round trip rather than by a raised exception —
     and the affiliate is SHOWN this text, so an empty one is a person told no
     with nothing to act on. */
  if (decision === 'reject' && (note ?? '').trim().length < 3) {
    return { ok: false, message: 'Write a reason first — the affiliate is shown it.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('decide_commission_payout', {
    p_admin_id: user.id,
    p_payout_id: id,
    p_decision: decision,
    p_note: note?.trim() || undefined,
  })

  if (error) return { ok: false, message: humanise(error.message), ...(await safeLists()) }

  revalidatePath('/admin/affiliates')
  revalidatePath('/admin')

  return { ok: true, ...(await safeLists()) }
}

/* ------------------------------------------------------------------ */
/* Mark one paid                                                       */
/* ------------------------------------------------------------------ */

/**
 * The irreversible one. `mark_commission_payout_paid` settles the hold into a
 * real `payout` ledger row, and nothing in the schema takes it back — so the
 * reference is REQUIRED rather than optional. An operator who cannot say where
 * the money went has not finished sending it.
 */
export async function markCommissionPayoutPaid(
  input: z.infer<typeof paidSchema>,
): Promise<AffiliateActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (await getViewAsSession()) return { ok: false, message: WHILE_VIEWING }

  const parsed = paidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Record the transfer reference — it is the only proof it was sent.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('mark_commission_payout_paid', {
    p_admin_id: user.id,
    p_payout_id: parsed.data.id,
    p_reference: parsed.data.reference.trim(),
  })

  if (error) return { ok: false, message: humanise(error.message), ...(await safeLists()) }

  revalidatePath('/admin/affiliates')
  revalidatePath('/admin')

  return { ok: true, ...(await safeLists()) }
}

/* ------------------------------------------------------------------ */
/* Suspend or reinstate an affiliate                                   */
/* ------------------------------------------------------------------ */

/**
 * Suspension stops somebody selling and stops them withdrawing; it does NOT
 * take their balance away, and the ledger is untouched. That asymmetry is
 * deliberate — money already earned is owed whatever the operator thinks of
 * the account, and a control that could erase a balance by mistake is a worse
 * risk than an account that keeps a balance it cannot move.
 */
export async function setAffiliateStatus(
  input: z.infer<typeof statusSchema>,
): Promise<AffiliateActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }
  if (await getViewAsSession()) return { ok: false, message: WHILE_VIEWING }

  const parsed = statusSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }
  const { affiliateId, status, reason } = parsed.data

  if (status === 'suspended' && (reason ?? '').trim().length < 3) {
    return { ok: false, message: 'Say why — it is recorded against the account.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_set_affiliate_status', {
    p_admin_id: user.id,
    p_affiliate_id: affiliateId,
    p_status: status,
    p_reason: reason?.trim() || undefined,
  })

  if (error) return { ok: false, message: humanise(error.message), ...(await safeLists()) }

  revalidatePath('/admin/affiliates')

  return { ok: true, ...(await safeLists()) }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Both lists, or an honest nothing.
 *
 * The decision and the re-read are two round trips, and the second failing
 * does not un-make the first. Reporting a successful approval as a failure
 * because the list could not be re-fetched would have an operator approve the
 * same withdrawal twice.
 */
async function safeLists(): Promise<{
  payouts?: CommissionPayout[]
  affiliates?: AffiliateRow[]
}> {
  try {
    const [payouts, affiliates] = await Promise.all([getCommissionPayouts(), getAffiliates()])
    return { payouts, affiliates }
  } catch (error) {
    reportUnexpected(error, 'admin.affiliates.lists')
    return {}
  }
}

/**
 * Postgres raises these with messages written for an operator — "That request
 * is already paid", "Only an approved withdrawal can be marked paid" — so they
 * are shown as they are. What is filtered out is the machinery: a constraint
 * name tells the operator nothing and reads as a crash.
 */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return GENERIC
  }
  return clean
}
