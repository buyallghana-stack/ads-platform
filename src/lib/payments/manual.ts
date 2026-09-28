import 'server-only'

import { randomInt } from 'node:crypto'

import { hubConfigured } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Paying for a plan by sending mobile money by hand (operator direction
 * 2026-09-28, when Paystack was switched off over its fees). See migration
 * 20260906000000 for why this is not a second money path.
 */

export type ManualPaymentConfig = {
  enabled: boolean
  number: string
  accountName: string
  network: string
}

const KEYS = [
  'manual_payment_enabled',
  'manual_payment_number',
  'manual_payment_account_name',
  'manual_payment_network',
  'paystack_checkout_enabled',
] as const

async function readConfig(): Promise<Record<(typeof KEYS)[number], string>> {
  const { data } = await createAdminClient().from('app_config').select('key, value').in('key', [...KEYS])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value ?? '']))
  return Object.fromEntries(KEYS.map((k) => [k, map[k] ?? ''])) as Record<(typeof KEYS)[number], string>
}

/** The manual option only exists once there is a number to send to. */
export async function getManualPaymentConfig(): Promise<ManualPaymentConfig> {
  const c = await readConfig()
  const number = c.manual_payment_number.trim()
  return {
    enabled: c.manual_payment_enabled === 'true' && number.length > 0,
    number,
    accountName: c.manual_payment_account_name.trim(),
    network: c.manual_payment_network.trim(),
  }
}

/**
 * Paystack at checkout: the hub has to be configured AND the operator's switch
 * on. A missing row counts as off, because the switch was added the day
 * Paystack was turned off.
 */
export async function paystackCheckoutEnabled(): Promise<boolean> {
  if (!hubConfigured()) return false
  return (await readConfig()).paystack_checkout_enabled === 'true'
}

// No 0/O or 1/I/L: this is read off a phone and typed into another one.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** What the buyer types as the mobile money reference, e.g. "P-7K3M9Q". */
export function newManualReference(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return `P-${s}`
}
