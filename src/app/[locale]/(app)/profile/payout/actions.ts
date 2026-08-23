'use server'

import { getSessionUser } from '@/lib/auth/session'
import { getRequestContext } from '@/lib/request-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { payoutSchema, type PayoutInput } from '@/lib/validation/payout'

/**
 * Save a payout destination (§6.4.1).
 *
 * The write goes through `set_payout_details`, a SECURITY DEFINER function
 * revoked from every client role — so it runs via the service-role admin
 * client here, never from the browser, and the user id is taken from the
 * verified session, NEVER from the submitted payload. The function validates
 * the provider/coin/network and the number/address pattern and raises human
 * messages on failure, which are surfaced verbatim.
 *
 * The 48h cool-off is not enforced here: saving is always allowed. It is the
 * WITHDRAWAL that waits 48h after a change (checked in request_redemption), so
 * a stolen session cannot both change the destination and cash out at once.
 */
export type PayoutResult = { ok: true } | { ok: false; errorKey?: string; message?: string }

export async function savePayoutDetails(input: PayoutInput): Promise<PayoutResult> {
  const parsed = payoutSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errorKey: parsed.error.issues[0].message }
  }
  const data = parsed.data

  const user = await getSessionUser()
  if (!user) return { ok: false, errorKey: 'notSignedIn' }

  const { ip } = await getRequestContext()
  const admin = createAdminClient()

  const args =
    data.method === 'mobile_money'
      ? {
          p_user_id: user.id,
          p_method: 'mobile_money' as const,
          p_provider_id: data.providerId,
          p_msisdn: data.msisdn,
          p_account_name: data.accountName,
          p_ip: ip,
        }
      : {
          p_user_id: user.id,
          p_method: 'crypto' as const,
          p_coin_id: data.coinId,
          // Omit (undefined) rather than null when there's no network — the DB
          // function defaults it to null; the generated types disallow null.
          p_network_id: data.networkId ?? undefined,
          p_wallet_address: data.walletAddress,
          p_ip: ip ?? undefined,
        }

  const { error } = await admin.rpc('set_payout_details', args)
  if (error) {
    // set_payout_details raises intelligible messages ("That number does not
    // look like a valid MTN Mobile Money number"). Pass them through.
    return { ok: false, message: error.message }
  }

  if (data.method === 'mobile_money' && data.msisdn) {
    await admin.from('profiles').update({ phone: data.msisdn }).eq('id', user.id)
  }

  return { ok: true }
}
