'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The legal name that goes on the certificate.
 *
 * It writes to the profile AND freezes onto the certificate. Freezing is the
 * point: a certificate is a record of what was true when it was issued, and a
 * document already downloaded and shared must not change because somebody
 * later edited their profile.
 *
 * The user id comes from the verified session, never from the payload — this
 * is a function that writes a name onto a document somebody will present.
 */
export type NameResult = { ok: true; legalName: string } | { ok: false; message: string }

export async function setCertificateName(
  productId: string,
  legalName: string,
): Promise<NameResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'Sign in and try again.' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('set_certificate_name', {
    p_user_id: user.id,
    p_product_id: productId,
    p_legal_name: legalName,
  })

  if (error) {
    reportUnexpected(error, 'certificate.setName')
    return { ok: false, message: 'Something went wrong. Try again in a moment.' }
  }

  const result = (data ?? {}) as { outcome?: string; legal_name?: string }
  if (result.outcome === 'too_short') {
    return { ok: false, message: 'Enter your full legal name, first and last.' }
  }
  if (result.outcome === 'too_long') {
    return { ok: false, message: 'That name is too long.' }
  }
  if (result.outcome !== 'ok') {
    return { ok: false, message: 'We could not find your certificate.' }
  }

  revalidatePath('/market/certificate/' + productId)
  revalidatePath('/learn')
  return { ok: true, legalName: result.legal_name ?? legalName }
}
