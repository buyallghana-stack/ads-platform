'use server'

import { z } from 'zod'

import { getAdministrators, type Administrator } from '@/lib/admin/data/administrators'
import { ADMIN_ROLES, type AdminRole } from '@/lib/admin/role-types'
import { getAdminRole } from '@/lib/admin/roles'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { getOrigin } from '@/lib/request-context'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Adding, re-roling and revoking administrators.
 *
 * WHO IS ACTING comes from the verified session and never from the payload. A
 * server action is a public HTTP endpoint, so anything the browser says about
 * who is doing this is a claim; the database checks it again through
 * `assert_admin`, which is also what puts a name against the change in the
 * audit trail.
 *
 * THE SERVICE CLIENT IS USED because `admin_grant_role` and
 * `admin_revoke_role` are revoked from `authenticated` — a signed-in browser
 * token cannot hand out administrator access under any circumstances.
 *
 * WHERE AN INVITATION LANDS: `/reset-password`. Not `/profile/credentials`,
 * which is where it pointed until 2026-07-31 and which HAS NEVER EXISTED —
 * that folder holds `actions.ts` and no page, so every invitation ended on a
 * 404. The screens that use those actions live at /profile/password and
 * /profile/email. `/profile/password` would be wrong here anyway: it asks for
 * the CURRENT password, and somebody who has just been invited does not have
 * one. `/reset-password` sets a password from the session alone, which is
 * exactly the situation an invited administrator is in.
 *
 * ⚠️ THE INVITATION EMAIL DEPENDS ON SUPABASE CONFIGURATION WE DO NOT CONTROL
 * FROM THIS REPOSITORY. The invite is sent with an explicit `redirectTo`
 * pointing at our own `/auth/confirm` route, which is correct and will work as
 * soon as the "Invite user" template uses `{{ .RedirectTo }}` with
 * `token_hash` — the same change the confirm, recovery and email-change
 * templates have been waiting for since 2026-07-25. Until an operator makes
 * it in the Supabase dashboard, the emailed link goes to Supabase's own verify
 * endpoint and returns its tokens in a URL fragment a server route cannot
 * read. The grant itself does not depend on any of that: the role is written
 * whether or not the email lands, and `accepted` on the list stays false until
 * they actually sign in.
 */

export type InviteResult =
  | { ok: true; admins: Administrator[]; emailed: boolean; existing: boolean }
  | { ok: false; error: string; admins?: Administrator[] }

const inviteSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  role: z.enum(ADMIN_ROLES),
})

/**
 * The list, or an empty one — never a throw.
 *
 * `getAdministrators` raises when the query fails, and an exception escaping a
 * server action is not an error message: it is the global error boundary, the
 * one that says "something went wrong, your points are unaffected". The
 * operator saw exactly that once while inviting somebody. A failure here is
 * worth reporting, and it is not worth taking the screen down for.
 */
async function safeList(): Promise<Administrator[]> {
  try {
    return await getAdministrators()
  } catch (error) {
    reportUnexpected(error, 'administrators list')
    return []
  }
}

/** Refuses anybody but a super admin, and returns their id. */
async function requireSuperAdmin(): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new Error('not signed in')
  if ((await getAdminRole()) !== 'super_admin') throw new Error('not a super admin')
  return user.id
}

export async function inviteAdmin(input: { email: string; role: string }): Promise<InviteResult> {
  let actorId: string
  try {
    actorId = await requireSuperAdmin()
  } catch {
    return { ok: false, error: 'notAllowed' }
  }

  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'badEmail' }
  const { email, role } = parsed.data

  const admin = createAdminClient()

  try {
    const { data: existingId, error: lookupError } = await admin.rpc('admin_user_id_by_email', {
      p_admin_id: actorId,
      p_email: email,
    })
    if (lookupError) throw lookupError

    let targetId = existingId as string | null
    let emailed = false

    if (!targetId) {
      /* No account yet, so the invitation both creates it and sends the mail.
         `redirectTo` is built from the REQUEST origin rather than a fixed
         environment variable, for the same reason /auth/confirm is: one value
         per environment is a value somebody forgets, and a preview deployment
         would email a link into production. */
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        email,
        { redirectTo: `${await getOrigin()}/auth/confirm?next=/reset-password` },
      )
      if (inviteError) throw inviteError
      targetId = invited.user?.id ?? null
      emailed = true
    }

    if (!targetId) return { ok: false, error: 'unexpected' }

    const { error: grantError } = await admin.rpc('admin_grant_role', {
      p_admin_id: actorId,
      p_target_id: targetId,
      p_role: role,
    })
    if (grantError) throw grantError

    /* NO revalidatePath HERE. It re-renders the page this action was called
       from, which remounts the board and throws away the notice that says
       whether the invitation was sent — so an operator pressed the button and
       saw nothing happen at all. The fresh list comes back in this result
       instead, which is the pattern the payout queue and people board already
       use. */
    return { ok: true, admins: await safeList(), emailed, existing: !emailed }
  } catch (error) {
    /* An address that is already registered as an admin, a Supabase rate
       limit, a refused role — all of these are things the operator can act on,
       so the message is surfaced rather than swallowed. Anything genuinely
       unexpected still goes to Sentry. */
    const message = error instanceof Error ? error.message : String(error)
    if (!/already|exists|rate limit|not an administrator|unknown role/i.test(message)) {
      reportUnexpected(error, 'inviteAdmin')
    }
    return { ok: false, error: message }
  }
}

export type RoleResult =
  | { ok: true; admins: Administrator[] }
  | { ok: false; error: string; admins?: Administrator[] }

export async function changeAdminRole(input: {
  userId: string
  role: string
}): Promise<RoleResult> {
  let actorId: string
  try {
    actorId = await requireSuperAdmin()
  } catch {
    return { ok: false, error: 'notAllowed' }
  }

  if (!ADMIN_ROLES.includes(input.role as AdminRole)) return { ok: false, error: 'badRole' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_grant_role', {
    p_admin_id: actorId,
    p_target_id: input.userId,
    p_role: input.role,
  })

  if (error) return { ok: false, error: error.message, admins: await safeList() }

  return { ok: true, admins: await safeList() }
}

export async function revokeAdmin(input: { userId: string }): Promise<RoleResult> {
  let actorId: string
  try {
    actorId = await requireSuperAdmin()
  } catch {
    return { ok: false, error: 'notAllowed' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_revoke_role', {
    p_admin_id: actorId,
    p_target_id: input.userId,
  })

  /* The database refuses two things on purpose — revoking yourself, and
     revoking the last super admin — and both messages are worth showing
     verbatim, because each explains a rule the operator did not know they
     were about to break. */
  if (error) return { ok: false, error: error.message, admins: await safeList() }

  return { ok: true, admins: await safeList() }
}


/**
 * Send somebody a fresh link to set their password.
 *
 * NEEDED BECAUSE THE FIRST LINK COULD BE DEAD. Every invitation sent before
 * 2026-07-31 pointed at /profile/credentials, a route that has never existed,
 * so the recipient clicked it and got a 404 — while the account and the role
 * were created perfectly well. Inviting them again does nothing: the address
 * now HAS an account, so the invite branch is skipped and no mail goes out.
 * Without this they are stranded, holding a role they cannot sign in to use.
 *
 * It sends the RECOVERY email rather than the invitation, on purpose: an
 * invitation is for an address with no account, and this one has one. The
 * recovery template already points at our own confirm route, and
 * `/reset-password` sets a password from the session alone — which is the
 * position somebody who has never had one is in.
 */
export async function resendInvite(input: { userId: string }): Promise<RoleResult> {
  let actorId: string
  try {
    actorId = await requireSuperAdmin()
  } catch {
    return { ok: false, error: 'notAllowed' }
  }
  void actorId

  const admin = createAdminClient()

  try {
    // The address comes from the DATABASE, never from the payload — a server
    // action is a public endpoint, and "send a password link to this address"
    // is not a thing to take on trust from a browser.
    const { data: found, error: lookupError } = await admin.auth.admin.getUserById(input.userId)
    if (lookupError) throw lookupError
    const email = found.user?.email
    if (!email) return { ok: false, error: 'unexpected' }

    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${await getOrigin()}/auth/confirm?next=/reset-password`,
    })
    if (error) throw error

    return { ok: true, admins: await safeList() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/rate limit/i.test(message)) reportUnexpected(error, 'resendInvite')
    return { ok: false, error: message, admins: await safeList() }
  }
}
