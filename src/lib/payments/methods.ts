import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Which payment methods are open, as the screens need to know it.
 *
 * ONE READ, FOUR KEYS, AND THE DATABASE IS STILL THE ENFORCEMENT
 * `set_payout_details` and `request_redemption` both call
 * `payout_method_enabled` and refuse a closed rail on their own. This module
 * exists so a user is never SHOWN a method that would be refused: a crypto
 * card that opens a form and then raises on save is a worse experience than
 * no card at all, and it is the same experience a bug would produce.
 *
 * Nothing here is a gate. If this file were deleted the money rules would
 * still hold; if the database checks were deleted, this would be decoration.
 *
 * WHY THE SERVICE CLIENT
 * `app_config`'s select policy is `is_public OR is_admin()`, and these four
 * rows are private. Read through a user's own token they come back as missing
 * rows rather than as an error, which would silently read as "everything is
 * switched off" for ordinary users and "everything is on" when an admin tests
 * it. That trap has caught this repository before.
 *
 * WHY A MISSING ROW MEANS ON, HERE, AND OFF IN THE DATABASE
 * They are answering different questions. The database is asked "may this
 * money move?" and an unknown rail must fail closed. A screen is asked "what
 * should I draw?", and a config read that failed must not blank the withdrawal
 * page for everybody; the save would refuse anyway, with a sentence saying
 * why. So the defaults here are the deployed ones, and the rows themselves
 * carry the operator's real answer.
 */

export type PaymentMethodSwitches = {
  /** Payout rails. These are enforced by the database as well. */
  payout: { mobileMoney: boolean; crypto: boolean }
  /**
   * What the upgrade checkout LISTS. Labels only: this app has no Paystack
   * call in it, the hub owns the payment page, and switching one off changes
   * what a buyer is told to expect rather than what Paystack will accept.
   */
  checkout: { mobileMoney: boolean; card: boolean }
}

const KEYS = [
  'payout_method_mobile_money_enabled',
  'payout_method_crypto_enabled',
  'checkout_lists_mobile_money',
  'checkout_lists_card',
] as const

export async function getPaymentMethodSwitches(): Promise<PaymentMethodSwitches> {
  const admin = createAdminClient()
  const { data } = await admin.from('app_config').select('key, value').in('key', KEYS)

  const rows = new Map((data ?? []).map((row) => [row.key, row.value === 'true']))
  const on = (key: (typeof KEYS)[number], fallback: boolean) => rows.get(key) ?? fallback

  return {
    payout: {
      mobileMoney: on('payout_method_mobile_money_enabled', true),
      // Matches the row shipped in migration 237: crypto is off until the
      // operator turns it on.
      crypto: on('payout_method_crypto_enabled', false),
    },
    checkout: {
      mobileMoney: on('checkout_lists_mobile_money', true),
      card: on('checkout_lists_card', true),
    },
  }
}
