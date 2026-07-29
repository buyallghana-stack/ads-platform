import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { AuditEntry } from '../types'

/**
 * The audit trail, for real.
 *
 * `admin_audit_log` stores row diffs — a table name, an id, and the whole
 * before and after as jsonb. That is the right thing to store and the wrong
 * thing to read, so `admin_list_audit` interprets them into events and unions
 * in `system_alerts`, and this module does nothing but rename the columns.
 *
 * NO INTERPRETATION HERE, ON PURPOSE. It would be easy to derive the action
 * from the entity type in TypeScript instead, and then the log would say
 * whatever this file believed rather than what the database recorded. One
 * definition, in SQL, next to the rows it reads.
 *
 * Entries the function could not name are already dropped by it. A log with
 * unreadable rows in it is a log an operator scrolls past, and this one has
 * to be readable on the day somebody asks who approved a payout.
 */

/** One row as `admin_list_audit` returns it. */
type AuditRow = {
  id: string
  at: string
  actor: string
  action: AuditEntry['action']
  target: string
  before: string | null
  after: string | null
  note: string | null
}

/**
 * The most recent events, newest first.
 *
 * The limit is generous rather than paginated: an operator is here to check
 * something they or the system just did, so the entry they want is nearly
 * always in the last few. When the volume outgrows that, the filter tabs move
 * server-side — the function already takes the argument.
 */
export async function getAuditEntries(limit = 200): Promise<AuditEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_audit', { p_limit: limit })

  if (error) {
    throw new Error(`Could not load the audit log: ${error.message}`)
  }

  return ((data ?? []) as unknown as AuditRow[]).map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    target: row.target,
    // Left undefined rather than nulled: the timeline draws a before → after
    // pair only when there genuinely was a before, and an em dash in that
    // slot looks like data went missing.
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    note: row.note ?? undefined,
  }))
}
