'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { PERSON_RULES } from '@/components/admin/person-actions'
import { getPeople, type PeopleScope } from '@/lib/admin/data/people'
import type { Person } from '@/lib/admin/types'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * What an operator does TO an account: flag it, clear it, disable it, let it
 * back in.
 *
 * Lives under /users because that is the canonical people screen, and it is
 * reached by the shared `PeopleBoard` rather than by any page directly — so
 * Flagged gets the same four writes without importing another route. Payouts
 * already works this way (`PayoutsTable` imports the payouts action).
 *
 * The acting admin's id comes from the verified session and NEVER from the
 * payload. A server action is a public HTTP endpoint; anything the browser
 * said about who is acting is a claim. The database checks that claim again
 * anyway — every one of these functions calls `assert_admin` as of migration
 * 054, which is also what puts the operator's name against the change in the
 * audit log (migration 053). Before 054 flagging and disabling were the only
 * admin actions still landing in the trail with nobody's name on them.
 *
 * The service client is used because all four functions are revoked from
 * `authenticated`: a signed-in browser token cannot disable an account under
 * any circumstances, which is the property worth having.
 *
 * WHY THE WHOLE LIST COMES BACK — same reasoning as the payout queue. The
 * screen renders what the DATABASE did, not what the UI predicted, and a
 * second operator's work in another tab shows up instead of being silently
 * painted over. On the Flagged screen it also means a cleared account leaves
 * the list, which is exactly what clearing it meant.
 */

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That change could not be saved. Please try again.'

const decisionSchema = z.object({
  id: z.uuid(),
  action: z.enum(['flag', 'clear', 'disable', 'enable']),
  reason: z.string().max(1000).optional(),
  /** Which list to hand back — the screen the operator is actually on. */
  scope: z.enum(['all', 'flagged']).default('all'),
})

export type PersonDecisionInput = z.input<typeof decisionSchema>

/**
 * `people` is optional on BOTH outcomes. The write and the re-read are two
 * round trips, and the second failing does not un-make the first: reporting a
 * successful disable as a failure would have an operator do it twice.
 */
export type PersonDecisionResult =
  | { ok: true; people?: Person[] }
  | { ok: false; message: string; people?: Person[] }

export async function decidePerson(
  input: PersonDecisionInput,
): Promise<PersonDecisionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = decisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }
  const { id, action, reason, scope } = parsed.data

  // The same rule the buttons obey, re-applied on this side. The client
  // deciding a flag needs no reason is not a reason for it to be allowed
  // one — the next operator to open this account reads that line, and so
  // does support when the person writes in.
  const rule = PERSON_RULES[action]
  if (rule.reason && (reason ?? '').trim().length < 3) {
    return { ok: false, message: 'Write a reason first — the next operator reads it.' }
  }

  // Guarded here as well as in the database, because the message is better.
  // Postgres would say "You cannot disable your own account" from behind a
  // stack trace; this says it before anything is attempted.
  if (action === 'disable' && id === user.id) {
    return { ok: false, message: 'You cannot disable your own account.' }
  }

  const admin = createAdminClient()
  const actor = { p_admin_id: user.id, p_user_id: id }

  /* Spelled out rather than dispatched through a lookup of function names.
     Each of these takes a different argument list, and a table mapping verbs
     to strings would type-check while passing `p_reason` to a function that
     has no such parameter — which PostgREST reports as "function does not
     exist", on the screen, at the worst moment. */
  const { error } = await (action === 'flag'
    ? admin.rpc('flag_user_account', { ...actor, p_reason: (reason ?? '').trim() })
    : action === 'disable'
      ? admin.rpc('disable_user_account', { ...actor, p_reason: (reason ?? '').trim() })
      : action === 'clear'
        ? admin.rpc('clear_user_flag', actor)
        : admin.rpc('enable_user_account', actor))

  if (error) {
    // Still hand back the list. When a change is refused because somebody
    // else already made it, the most useful thing on screen is the truth.
    return { ok: false, message: humanise(error.message), people: await safePeople(scope) }
  }

  revalidatePath('/admin/users')
  revalidatePath('/admin/flagged')
  revalidatePath('/admin')

  return { ok: true, people: await safePeople(scope) }
}

/* ------------------------------------------------------------------ */

/** The list, or the last thing we can say honestly: nothing. */
async function safePeople(scope: PeopleScope): Promise<Person[] | undefined> {
  try {
    return await getPeople(scope)
  } catch {
    return undefined
  }
}

/**
 * These are raised for an operator to read — "A reason is required to disable
 * an account", "Unknown user" — so they are shown as-is. What is filtered out
 * is the machinery: a constraint name tells the operator nothing and looks
 * like a crash.
 */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return GENERIC
  }
  return clean
}
