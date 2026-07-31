'use server'

import { revalidatePath } from 'next/cache'

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
        { redirectTo: `${await getOrigin()}/auth/confirm?next=/profile/credentials` },
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

    revalidatePath('/admin/settings')
    return { ok: true, admins: await getAdministrators(), emailed, existing: !emailed }
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

  if (error) return { ok: false, error: error.message, admins: await getAdministrators() }

  revalidatePath('/admin/settings')
  return { ok: true, admins: await getAdministrators() }
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
  if (error) return { ok: false, error: error.message, admins: await getAdministrators() }

  revalidatePath('/admin/settings')
  return { ok: true, admins: await getAdministrators() }
}
