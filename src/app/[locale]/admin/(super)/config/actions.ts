'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import type { ConfigValue } from '@/lib/admin/data/config'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Saving platform settings — the numbers that decide how much money leaves.
 *
 * Everything goes through `admin_set_config`, which takes the acting admin's
 * id and verifies the role itself. The id comes from the verified session
 * here and never from the payload.
 *
 * NOTHING IS VALIDATED TWICE
 * The bounds live on each `app_config` row and the database checks them.
 * Re-implementing "a daily cap must be at least 0" in TypeScript would create
 * a second set of limits to keep in step with the first, and the copy that
 * drifts is always the one furthest from the data. This action checks the
 * SHAPE of the request — that it is settings and values at all — and lets the
 * database rule on the values.
 *
 * WHAT COMES BACK IS WHAT CHANGED
 * `admin_set_config` returns one row per setting that actually moved, so the
 * confirmation can say "3 settings updated" and mean it. Re-saving a form
 * with nothing altered returns zero rows and says so, rather than claiming a
 * save that wrote nothing.
 */

const saveSchema = z.object({
  values: z.record(
    z.string().regex(/^[a-z][a-z0-9_]*$/),
    z.union([z.string(), z.number(), z.boolean()]),
  ),
})

export type ConfigChange = { key: string; from: string; to: string }

export type SaveConfigResult =
  | { ok: true; changed: ConfigChange[] }
  | { ok: false; message: string }

export async function saveConfig(values: Record<string, ConfigValue>): Promise<SaveConfigResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: 'You are not signed in as an administrator.' }

  const parsed = saveSchema.safeParse({ values })
  if (!parsed.success) {
    return { ok: false, message: 'Those settings could not be read. Please reload and try again.' }
  }

  const entries = Object.entries(parsed.data.values)
  if (entries.length === 0) return { ok: true, changed: [] }

  // Everything crosses as text, which is how app_config stores it. Doing the
  // conversion here rather than in SQL keeps one representation of "false"
  // and "3.000" instead of relying on jsonb's idea of them.
  const payload: Record<string, string> = {}
  for (const [key, value] of entries) payload[key] = String(value)

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('admin_set_config', {
    p_admin_id: user.id,
    p_values: payload,
  })

  if (error) return { ok: false, message: humanise(error.message) }

  revalidatePath('/admin/config')
  // The settings screen is not the only thing these numbers drive: the
  // overview's figures and the payout queue's rules read them too.
  revalidatePath('/admin')

  const rows = (data ?? []) as unknown as {
    config_key: string
    previous_value: string
    new_value: string
  }[]

  return {
    ok: true,
    changed: rows.map((r) => ({ key: r.config_key, from: r.previous_value, to: r.new_value })),
  }
}

/**
 * `admin_set_config` raises in operator language and names the field — "
 * ad_retry_cap must be at most 10", "Unknown setting: x" — so those are shown
 * as-is. What gets filtered is raw constraint machinery, which reads like a
 * crash and tells nobody anything.
 */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return 'Those settings could not be saved. Please check the values and try again.'
  }
  return clean
}
