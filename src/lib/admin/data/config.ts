import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Platform settings, for real.
 *
 * WHY THE SERVICE CLIENT AND NOT THE USER'S
 * `app_config`'s select policy is `is_public OR is_admin()`. Reading it with
 * an admin's own token happens to work and returns NOTHING for everybody
 * else — silently, as a missing row rather than an error. This repo has
 * already been caught by that once (see `ads-data.ts`), so the private keys
 * are read through the service client, where the answer is the same every
 * time.
 *
 * WHY THE BOUNDS COME BACK TOO
 * Every row carries its own `value_type`, `min_value` and `max_value`, and
 * `admin_set_config` validates against exactly those. If the form declared
 * its own limits, there would be two sources of truth for "what is a legal
 * daily cap" and the form's copy would be the one that drifts. So the screen
 * describes what a field MEANS — label, help text, warning — and the database
 * says what it may HOLD.
 */

export type ConfigValue = string | number | boolean

export type ConfigMeta = {
  key: string
  type: 'int' | 'decimal' | 'bool' | 'text'
  min: number | null
  max: number | null
  /** The row's own description, written when the setting was introduced. */
  description: string
}

export type PlatformConfig = {
  /** Current values, typed the way the form wants them. */
  values: Record<string, ConfigValue>
  /** Per-key bounds, so the inputs constrain the same way the writer does. */
  meta: Record<string, ConfigMeta>
}

type Row = {
  key: string
  value: string
  value_type: 'int' | 'decimal' | 'bool' | 'text'
  min_value: string | number | null
  max_value: string | number | null
  description: string
}

/** Text out of the database into the shape the control expects. */
function decode(row: Row): ConfigValue {
  switch (row.value_type) {
    case 'bool':
      return row.value === 'true'
    case 'int':
    case 'decimal':
      return Number(row.value)
    default:
      return row.value
  }
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('app_config')
    .select('key, value, value_type, min_value, max_value, description')
    .order('key')

  if (error) {
    // A settings screen that renders blank inputs invites an operator to
    // "fix" them by typing values in, which would write real numbers over
    // real ones from a form that never knew what they were.
    throw new Error(`Could not load platform settings: ${error.message}`)
  }

  const values: Record<string, ConfigValue> = {}
  const meta: Record<string, ConfigMeta> = {}

  for (const row of (data ?? []) as Row[]) {
    values[row.key] = decode(row)
    meta[row.key] = {
      key: row.key,
      type: row.value_type,
      min: row.min_value === null ? null : Number(row.min_value),
      max: row.max_value === null ? null : Number(row.max_value),
      description: row.description,
    }
  }

  return { values, meta }
}
