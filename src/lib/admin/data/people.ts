import 'server-only'

import { avatarPublicUrl } from '@/lib/profile/avatar'
import { createClient } from '@/lib/supabase/server'

import type { Person } from '../types'

/**
 * The accounts behind Users and Flagged, for real. Nothing here comes from
 * preview.ts.
 *
 * ONE FUNCTION, TWO SCREENS — the same split the operator asked for in the
 * UI. `admin_list_people` takes a scope and Flagged is that scope, not a
 * client-side filter over the full list. The difference matters once there
 * are more than a few hundred accounts: filtering in the browser means
 * shipping every user to draw a list of six.
 *
 * THE USER'S OWN CLIENT, as with payouts and ads. `admin_list_people` is
 * SECURITY DEFINER but re-checks `is_admin()` for a non-null caller, so this
 * read answers to the same predicate that guards every admin table. The
 * service key stays for the writes, where the acting admin's identity has to
 * come from somewhere the browser cannot reach.
 *
 * THE MESSAGE COLUMNS come from the same function, left-joined off the
 * support thread. They are null for anybody who has never written, which is
 * exactly what the Users and Flagged cards want — undefined rather than a
 * zero that would read as "nobody has written in".
 */

export type PeopleScope = 'all' | 'flagged' | 'messages'

/** One row as `admin_list_people` returns it. */
type PersonRow = {
  id: string
  name: string
  email: string
  phone: string | null
  avatar_path: string | null
  joined_at: string
  balance_points: number | string
  tier: string
  status: 'active' | 'flagged' | 'disabled'
  flagged_by: 'system' | 'admin' | null
  flag_reason: string | null
  lifetime_points: number | string
  ads_watched: number
  referrals: number
  last_active_at: string
  paid_out_ghs: number | string
  tier_multiplier: number | string | null
  tier_paid_ghs: number | string
  last_message: string | null
  last_message_at: string | null
  unread: number | null
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: avatarPublicUrl(row.avatar_path),
    joinedAt: row.joined_at,
    // bigint and numeric arrive as strings over PostgREST once they are large
    // enough. Converted here, once, so nothing downstream does string
    // arithmetic on a balance.
    balancePoints: Number(row.balance_points),
    tier: row.tier,
    // Null only if the tier could not be resolved at all, which the left
    // lateral join deliberately allows rather than dropping the account.
    tierMultiplier: row.tier_multiplier === null ? 1 : Number(row.tier_multiplier),
    tierPaidGhs: Number(row.tier_paid_ghs),
    status: row.status,
    flaggedBy: row.flagged_by ?? undefined,
    flagReason: row.flag_reason ?? undefined,
    lifetimePoints: Number(row.lifetime_points),
    adsWatched: row.ads_watched,
    referrals: row.referrals,
    lastActiveAt: row.last_active_at,
    paidOutGhs: Number(row.paid_out_ghs),
    lastMessage: row.last_message ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    unread: row.unread ?? undefined,
  }
}

export async function getPeople(scope: PeopleScope = 'all'): Promise<Person[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_people', { p_scope: scope })

  if (error) {
    // An empty Flagged screen means "nobody needs looking at", which is the
    // one thing it must never say wrongly. Fail loudly instead.
    throw new Error(`Could not load accounts: ${error.message}`)
  }

  return ((data ?? []) as unknown as PersonRow[]).map(toPerson)
}

/**
 * How many accounts are flagged or disabled, for the badge on the nav.
 *
 * A count query rather than `getPeople('flagged').length`, because the layout
 * runs this on every admin page load including the ones that never show an
 * account. Finalised deletions are excluded for the same reason they are
 * excluded from the list: they are not people an operator can act on.
 */
export async function countFlaggedAccounts(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .or('flagged_at.not.is.null,disabled_at.not.is.null')

  return error ? 0 : (count ?? 0)
}


/**
 * People waiting on a reply, for the Messages badge.
 *
 * Counts PEOPLE and not messages: somebody who asks three questions is one
 * conversation to answer, and a badge reading "3" for one person would send
 * an operator looking for two more.
 */
export async function countUnreadSupport(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_count_unread_support')
  return error ? 0 : (data ?? 0)
}
