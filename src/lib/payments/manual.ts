import 'server-only'

import { randomInt } from 'node:crypto'

import { hubConfigured } from '@/lib/env'
import { isNightClosed } from '@/lib/payments/night-hours'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Paying for a plan by sending mobile money by hand (operator direction
 * 2026-09-28, when Paystack was switched off over its fees). See migration
 * 20260906000000 for why this is not a second money path.
 */

export type ManualPaymentConfig = {
  /** On, a number set, AND inside today's opening hours. */
  enabled: boolean
  /** On with a number set, but outside the opening hours right now. */
  closedForNight: boolean
  /** When it opens again, 0 to 23, Ghana time. */
  openHour: number
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
  'manual_payment_close_hour',
  'manual_payment_open_hour',
] as const

async function readConfig(): Promise<Record<(typeof KEYS)[number], string>> {
  const { data } = await createAdminClient().from('app_config').select('key, value').in('key', [...KEYS])
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value ?? '']))
  return Object.fromEntries(KEYS.map((k) => [k, map[k] ?? ''])) as Record<(typeof KEYS)[number], string>
}

const hourOr = (value: string, fallback: number) => {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback
}

/** The manual option only exists once there is a number to send to, and
 *  closes at night (operator, 2026-09-28): nobody is awake to confirm it. */
export async function getManualPaymentConfig(): Promise<ManualPaymentConfig> {
  const c = await readConfig()
  const number = c.manual_payment_number.trim()
  const available = c.manual_payment_enabled === 'true' && number.length > 0
  const closeHour = hourOr(c.manual_payment_close_hour, 22)
  const openHour = hourOr(c.manual_payment_open_hour, 8)
  const closed = available && isNightClosed(new Date().getUTCHours(), closeHour, openHour)
  return {
    enabled: available && !closed,
    closedForNight: closed,
    openHour,
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
