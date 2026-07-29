'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getPayoutQueue } from '@/lib/admin/data/payouts'
import { ACTION_RULES, type PayoutAction } from '@/components/admin/payout-actions'
import type { PayoutRequest } from '@/lib/admin/types'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Decisions on the payout queue — the writes the whole admin area exists for.
 *
 * Everything routes through `admin_decide_redemption`, which takes the acting
 * admin's id and verifies the role itself. The id comes from the verified
 * session HERE and never from the payload: a server action is a public HTTP
 * endpoint, so anything the browser sent about who is acting is a claim, not
 * evidence.
 *
 * The service client is used because every function in the redemption
 * pipeline is revoked from `authenticated` — a signed-in browser token cannot
 * approve a payout under any circumstances, which is the property that makes
 * the pipeline worth having.
 *
 * WHY THE WHOLE QUEUE COMES BACK
 * Each decision returns the refreshed list rather than the one row that
 * changed. It costs one extra query on an action a human just took, and it
 * buys two things worth more than that: the table shows what the DATABASE
 * says happened rather than what the UI predicted (`approve` on a request
 * still inside its holding period does not become `approved`, and marking
 * paid while the licence flag is off does not become `paid`), and a second
 * operator's work in another tab appears instead of being silently
 * overwritten.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That decision could not be recorded. Please try again.'

/** The UI's verbs, mapped to the ones the database dispatcher knows. */
const DB_ACTION: Record<PayoutAction, string> = {
  approve: 'approve',
  hold: 'hold',
  decline: 'decline',
  markPaid: 'mark_paid',
  dispute: 'dispute',
}

const decisionSchema = z.object({
  id: z.uuid(),
  action: z.enum(['approve', 'hold', 'decline', 'markPaid', 'dispute']),
  reason: z.string().max(1000).optional(),
  /** Free-text proof the transfer happened. Only meaningful for markPaid. */
  reference: z.string().max(200).optional(),
})

export type DecisionInput = z.infer<typeof decisionSchema>

/**
 * `requests` is the refreshed queue, and it is optional on BOTH outcomes.
 *
 * The decision and the re-read are two separate round trips, and the second
 * one failing does not un-make the first. Reporting a successful approval as
 * a failure because the list could not be re-fetched afterwards would have an
 * operator approve the same payout twice.
 */
export type DecisionResult =
  | { ok: true; requests?: PayoutRequest[] }
  | { ok: false; message: string; requests?: PayoutRequest[] }

/* ------------------------------------------------------------------ */
/* One decision                                                        */
/* ------------------------------------------------------------------ */

export async function decidePayout(input: DecisionInput): Promise<DecisionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = decisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }
  const { id, action, reason, reference } = parsed.data

  // The same rule the buttons obey, re-applied on this side. The client
  // deciding that a decline needs no reason is not a reason for it to be
  // allowed one — and the user is shown this text, so an empty one is a
  // person told no with nothing to act on.
  if (ACTION_RULES[action].reason && (reason ?? '').trim().length < 3) {
    return { ok: false, message: 'Write a reason first — the user is shown it.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_decide_redemption', {
    p_admin_id: user.id,
    p_redemption_id: id,
    p_action: DB_ACTION[action],
    p_reason: reason?.trim() || undefined,
    p_reference: reference?.trim() || undefined,
  })

  if (error) {
    // Still hand back the refreshed queue. When a decision is refused because
    // somebody else already made it, the most useful next thing on screen is
    // the truth, not the stale row that provoked the attempt.
    return { ok: false, message: humanise(error.message), requests: await safeQueue() }
  }

  revalidatePath('/admin/payouts')
  revalidatePath('/admin')

  return { ok: true, requests: await safeQueue() }
}

/* ------------------------------------------------------------------ */
/* Bulk approve                                                        */
/* ------------------------------------------------------------------ */

/**
 * Approving a batch of clean payouts, one database call per request.
 *
 * Deliberately NOT one transaction. Each approval is an independent decision
 * about a different person's money, and one request failing its own guard —
 * still inside its holding period, already decided by somebody else — is not
 * a reason to undo the nineteen that were fine. The caller is told how many
 * of each.
 *
 * Only approve is offered in bulk. A bulk decline is twenty people told no
 * without anyone having read why.
 */
export async function approvePayouts(
  ids: string[],
): Promise<DecisionResult & { approved?: number; failed?: number }> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = z.array(z.uuid()).max(200).safeParse(ids)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  let approved = 0
  const failures: string[] = []

  for (const id of parsed.data) {
    const { error } = await admin.rpc('admin_decide_redemption', {
      p_admin_id: user.id,
      p_redemption_id: id,
      p_action: 'approve',
    })
    if (error) failures.push(humanise(error.message))
    else approved += 1
  }

  revalidatePath('/admin/payouts')
  revalidatePath('/admin')

  const requests = await safeQueue()

  if (failures.length > 0) {
    return {
      ok: false,
      // One distinct reason is worth stating; five different ones are not
      // worth stacking into a paragraph nobody reads on a toast.
      message:
        new Set(failures).size === 1
          ? `${approved} approved. ${failures.length} could not be: ${failures[0]}`
          : `${approved} approved. ${failures.length} could not be.`,
      requests,
      approved,
      failed: failures.length,
    }
  }

  return { ok: true, requests, approved, failed: 0 }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The queue, or the last thing we can say honestly: nothing. */
async function safeQueue(): Promise<PayoutRequest[] | undefined> {
  try {
    return await getPayoutQueue()
  } catch {
    return undefined
  }
}

/**
 * Postgres raises these with messages written for an operator — "Only an
 * approved redemption can be marked paid", "Payouts are disabled" — so they
 * are shown as-is. What is filtered out is the machinery: a constraint name
 * tells the operator nothing and looks like a crash.
 */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return GENERIC
  }
  return clean
}
