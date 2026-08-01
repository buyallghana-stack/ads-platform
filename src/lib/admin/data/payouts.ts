import 'server-only'

import { avatarPublicUrl } from '@/lib/profile/avatar'
import { createClient } from '@/lib/supabase/server'

import type { PayoutRequest, PayoutStatus } from '../types'

/**
 * The payout queue, for real. Nothing here comes from preview.ts.
 *
 * This is the first screen off the preview seam, and the seam did its job:
 * `getPayoutQueue()` returns the same `PayoutRequest[]` that
 * `preview.payoutRequests()` did, so the page swapped one call for another
 * and PayoutsTable, PayoutDrawer and every masking rule were untouched.
 *
 * ONE CLIENT, AND IT IS THE USER'S OWN
 * `admin_list_redemptions` is SECURITY DEFINER but re-checks `is_admin()` for
 * a non-null caller, so a read on every page load answers to the same RLS
 * predicate that guards every admin table and needs no service key. That is
 * the same split `ads-data.ts` uses, and the reason is the same: the service
 * key is for the things a browser token must never be able to ask for, and a
 * list of payouts an admin is already entitled to see is not one of them.
 *
 * DESTINATIONS ARRIVE WHOLE
 * The function returns them unmasked and so does this module. Masking is
 * `maskDestination`'s job at render — see `destination.ts` for why the mask
 * belongs in the view and not in the data.
 */

/** Shape of one row as `admin_list_redemptions` returns it. */
type QueueRow = {
  id: string
  reference: string
  user_id: string
  user_name: string
  user_email: string
  user_avatar_path: string | null
  user_joined_at: string
  paid_before: number
  paid_before_ghs: number | string
  points: number | string
  ghs: number | string
  fee_percent: number | string
  fee_ghs: number | string
  net_ghs: number | string
  coin_code: string | null
  coin_amount: number | string | null
  live_coin_amount: number | string | null
  quoted_at: string | null
  method: 'crypto' | 'mobile_money'
  provider: string
  destination: string
  account_name: string
  reuse: number
  status: PayoutStatus
  requested_at: string
  status_changed_at: string
  holding_until: string
  admin_hold_at: string | null
  approved_early: boolean
  risk: 'low' | 'medium' | 'high' | 'critical'
  risk_reasons: string[] | null
  decision_note: string | null
}

/**
 * Why an operator should look twice at this request.
 *
 * Two sources, deliberately combined here rather than in SQL. The recorded
 * fraud signals are facts the database owns and names for itself. The other
 * two are arithmetic on figures already in the row — how many other accounts
 * share this destination, and how old the account is — and computing them in
 * the query would mean the same numbers appearing twice, once as a count the
 * UI shows and once as a sentence about that count that could disagree with
 * it.
 *
 * Ordered most damaging first, and shared destinations lead: it is the one
 * signal here that implicates money already leaving to somewhere it has
 * left before.
 */
function riskReasons(row: QueueRow, joinedDaysAgo: number): string[] {
  const reasons: string[] = []

  if (row.reuse > 0) {
    reasons.push(
      row.reuse === 1
        ? 'Destination already used by 1 other account'
        : `Destination already used by ${row.reuse} other accounts`,
    )
  }

  // A young account cashing out is only worth saying when the account really
  // is young; on a six-month-old account the age is reassurance, not a risk,
  // and printing it as a "reason" would train the operator to skim the list.
  if (joinedDaysAgo < 14) {
    reasons.push(
      joinedDaysAgo < 1
        ? 'Account opened today'
        : `Account is ${Math.floor(joinedDaysAgo)} day${joinedDaysAgo < 2 ? '' : 's'} old`,
    )
  }

  if (row.paid_before === 0) reasons.push('First payout on this account')

  reasons.push(...(row.risk_reasons ?? []))

  return reasons
}

function toRequest(row: QueueRow, now: number): PayoutRequest {
  const joinedDaysAgo = (now - new Date(row.user_joined_at).getTime()) / 86_400_000

  return {
    id: row.id,
    reference: row.reference,
    user: {
      name: row.user_name,
      email: row.user_email,
      avatarUrl: avatarPublicUrl(row.user_avatar_path),
      joinedAt: row.user_joined_at,
      paidBefore: row.paid_before,
      paidBeforeGhs: Number(row.paid_before_ghs),
    },
    // bigint and numeric both arrive as strings over PostgREST once they are
    // large enough. Number() here rather than at each use site, so nothing
    // downstream ever does string arithmetic on money.
    points: Number(row.points),
    ghs: Number(row.ghs),
    /* Frozen when the request was filed. `netGhs` is what the operator
       actually sends — paying the gross would be sending the fee back out
       with the money. */
    feePercent: Number(row.fee_percent),
    feeGhs: Number(row.fee_ghs),
    netGhs: Number(row.net_ghs),
    /*
      What to actually send, for a crypto payout. `coinAmount` is the figure
      frozen when the user asked; `liveCoinAmount` is only present when
      nothing was frozen because no fresh rate existed then. The screen must
      keep them apart — one is what the user was quoted, the other is a
      figure nobody has been promised.
    */
    coin: row.coin_code ?? undefined,
    coinAmount: row.coin_amount === null ? undefined : Number(row.coin_amount),
    liveCoinAmount:
      row.live_coin_amount === null ? undefined : Number(row.live_coin_amount),
    quotedAt: row.quoted_at ?? undefined,
    method: row.method,
    provider: row.provider,
    destination: row.destination,
    accountName: row.account_name,
    reuse: row.reuse,
    status: row.status,
    requestedAt: row.requested_at,
    statusChangedAt: row.status_changed_at,
    risk: row.risk,
    riskReasons: riskReasons(row, joinedDaysAgo),
    decisionNote: row.decision_note ?? undefined,
    // Carried so the panel can say WHEN the window ends and the button can
    // ask for the override. These were already on the row and simply were
    // not being passed on, which is why Approve on a held request could only
    // ever fail.
    holdingUntil: row.holding_until ?? undefined,
    adminHeld: row.admin_hold_at !== null,
    approvedEarly: row.approved_early,
  }
}

/**
 * Every redemption, queue first.
 *
 * Unfiltered on purpose: the table's own tabs (queue, approved, paid,
 * rejected, all) filter client-side over one list, and paginating
 * underneath them would make a tab show "12" and then list four. When the
 * volume justifies it, the filter moves into `p_status` and the tabs become
 * server round trips — the function already takes the argument.
 */
export async function getPayoutQueue(): Promise<PayoutRequest[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_redemptions')

  if (error) {
    // An admin staring at an empty queue that is not empty would approve
    // nothing and assume there was nothing to approve. Fail loudly.
    throw new Error(`Could not load the payout queue: ${error.message}`)
  }

  const now = Date.now()
  return ((data ?? []) as unknown as QueueRow[]).map((row) => toRequest(row, now))
}

/**
 * How many payouts are waiting on somebody, for the badge on the nav.
 *
 * A count query rather than `getPayoutQueue().length` because the layout runs
 * this on every admin page load, including the ones that never show a payout.
 */
export async function countPayoutsAwaitingDecision(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('redemptions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending_approval', 'held'])

  return error ? 0 : (count ?? 0)
}
