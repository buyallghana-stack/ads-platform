import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Data assembly for the Home tab.
 *
 * Everything here reads through the USER's client, so RLS is the guard —
 * the ledger, subscription payments and redemptions all carry
 * "own rows or admin" select policies. No service key in the read path.
 *
 * The feed merges two sources the operator wants in one history:
 *   points_ledger          points in/out (earn, bonus, withdrawal, refund…)
 *   subscription_payments  plan purchases — deliberately OUTSIDE the points
 *                          economy (§6.7), paid in GHS, so they carry a fiat
 *                          amount and no running points balance.
 */

/** Display grouping: Ads / Survey / Bonus / Withdrawal / Refund /
 *  Subscription / Adjustment.
 *
 *  The video kind was called "Earned" (operator, 2026-07-25: "the transaction
 *  history ads is called earn, change it to ads"). Every credit row is
 *  earnings, so "Earned" named the wrong axis — it said what happened to the
 *  balance instead of what the user did. The key is `ad`, not `earned`, so the
 *  code and the label cannot drift apart again.
 *
 *  Survey was folded into `earned` and therefore labelled "Ad reward", which
 *  stopped being true once surveys became their own thing users choose on the
 *  Ads tab. It is its own kind now so the row says what actually happened and
 *  the filter chips can separate the two. */
export type TxKind =
  | 'ad'
  | 'survey'
  | 'bonus'
  | 'gift'
  | 'game'
  | 'task'
  | 'withdrawal'
  | 'refund'
  | 'subscription'
  | 'adjustment'
  | 'vault'

export type TxRow = {
  id: string
  kind: TxKind
  /** Payout / payment method when one applies (withdrawals, subscriptions). */
  method: string | null
  /** Crypto withdrawals only: the coin and the amount recorded on the
   *  redemption. A crypto payout is denominated in the coin, not in cedis —
   *  cedis are for mobile money (operator rule, 2026-07-29). */
  coin?: string
  coinAmount?: number
  /** Signed points delta. Null for subscription rows — they are fiat. */
  points: number | null
  /** Running points balance after the entry. Null for fiat rows. */
  balanceAfter: number | null
  /** GHS value. For points rows, derived from the rate frozen on the entry;
   *  for subscriptions, the actual amount paid. */
  ghs: number
  /** ISO timestamp. */
  at: string
  /** Whether money left vs entered, for glyph + sign colouring. */
  direction: 'in' | 'out'
  /** Pending/failed subscription payments are shown honestly. */
  status: 'settled' | 'pending' | 'failed'
}

const LEDGER_KIND: Record<string, TxKind> = {
  ad_view: 'ad',
  survey: 'survey',
  referral_signup: 'bonus',
  referral_activation: 'bonus',
  // Stage three, the commission when a referee buys a plan. Folded into the
  // same kind as the other two on purpose: all three are money the user got
  // for inviting somebody, they share the orange referral hue, and one filter
  // chip should show all of them. Unlike the survey/ad case, the label does
  // not become untrue — this genuinely is a referral bonus.
  referral_purchase: 'bonus',
  // Its own kind, not folded into `bonus`: that label reads "Referral bonus",
  // and without a mapping here a redeemed gift code fell through to the
  // `?? 'adjustment'` default and told the user their gift was an account
  // correction. Same family of bug as surveys once reading "Ad reward".
  gift_code: 'gift',
  // Third time this fall-through has been caught: without a mapping a game
  // win reads as "Account correction" in the user's own history.
  game_prize: 'game',
  // Fourth time. See the note above gift_code.
  task_reward: 'task',
  weekly_bonus: 'bonus',
  redemption_request: 'withdrawal',
  redemption_refund: 'refund',
  admin_adjustment: 'adjustment',
  vault_deposit: 'vault',
  vault_payout: 'vault',
}

export type DailyPoint = {
  /** UTC day, YYYY-MM-DD. */
  day: string
  /** Points earned that day (credits from earning, not refunds). */
  earned: number
  /** Valid ad views that day. */
  adsWatched: number
}

export type HomeData = {
  feed: TxRow[]
  /** Last 30 UTC days, oldest first, zero-filled. */
  daily: DailyPoint[]
}

const FEED_LIMIT = 60

export async function getHomeData(userId: string): Promise<HomeData> {
  const supabase = await createClient()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [ledgerRes, chartRes, subsRes, vaultRes] = await Promise.all([
    supabase
      .from('points_ledger')
      .select(
        'id, entry_type, amount, balance_after, points_per_currency_unit, reference_type, reference_id, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(FEED_LIMIT),
    // Separate query: the feed page may not reach 30 days back, and the
    // chart must. Only earning-relevant columns.
    //
    // `gift_code` is deliberately absent, like `admin_adjustment`: the chart
    // plots what the user earned, and a code the operator handed out would
    // draw a spike on a day they did nothing.
    supabase
      .from('points_ledger')
      .select('entry_type, amount, created_at')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .in('entry_type', [
        'ad_view',
        'survey',
        'referral_signup',
        'referral_activation',
        'referral_purchase',
      ]),
    /*
      ONLY PAYMENTS THAT COMPLETED. A `pending` row is a checkout somebody
      opened, not money that moved: Paystack is handed the row before the user
      reaches the card form, so abandoning the page — or paying on a second
      attempt after the first one stalled — leaves a pending row behind
      permanently.
    */
    supabase
      .from('subscription_payments')
      .select('id, method, status, amount_minor, currency_code, created_at')
      .eq('user_id', userId)
      .in('status', ['confirmed', 'refunded'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('vault_payments')
      .select('id, method, status, amount_minor, currency_code, created_at')
      .eq('user_id', userId)
      .eq('method', 'paystack')
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const ledger = ledgerRes.data ?? []
  const subs = subsRes.data ?? []
  const vaults = vaultRes.data ?? []

  // Withdrawal rows want the payout method (MoMo vs crypto) on the icon.
  // The ledger stores the redemption id; one IN query resolves them all.
  const redemptionIds = ledger
    .filter((e) => e.reference_type === 'redemption' && e.reference_id)
    .map((e) => e.reference_id as string)

  const methodById = new Map<string, string>()
  const coinById = new Map<string, { coin: string; amount: number }>()
  if (redemptionIds.length > 0) {
    const { data: redemptions } = await supabase
      .from('redemptions')
      .select('id, method, snapshot_coin_code, coin_amount')
      .in('id', redemptionIds)
    for (const r of redemptions ?? []) {
      methodById.set(r.id, r.method)
      if (r.snapshot_coin_code && r.coin_amount !== null) {
        coinById.set(r.id, { coin: r.snapshot_coin_code, amount: Number(r.coin_amount) })
      }
    }
  }

  const feed: TxRow[] = [
    ...ledger.map((e): TxRow => {
      const kind = LEDGER_KIND[e.entry_type] ?? 'adjustment'
      return {
        id: `l-${e.id}`,
        kind,
        method:
          e.reference_type === 'redemption' && e.reference_id
            ? (methodById.get(e.reference_id) ?? null)
            : null,
        coin:
          e.reference_type === 'redemption' && e.reference_id
            ? coinById.get(e.reference_id)?.coin
            : undefined,
        coinAmount:
          e.reference_type === 'redemption' && e.reference_id
            ? coinById.get(e.reference_id)?.amount
            : undefined,
        points: e.amount,
        balanceAfter: e.balance_after,
        // The rate frozen on the entry, so history never silently reprices.
        ghs: Math.abs(e.amount) / e.points_per_currency_unit,
        at: e.created_at,
        direction: e.amount > 0 ? 'in' : 'out',
        status: 'settled',
      }
    }),
    ...subs.map(
      (s): TxRow => ({
        id: `s-${s.id}`,
        kind: 'subscription',
        method: s.method,
        points: null,
        balanceAfter: null,
        ghs: s.amount_minor / 100,
        at: s.created_at,
        direction: 'out',
        status: s.status === 'failed' ? 'failed' : 'settled',
      }),
    ),
    ...vaults.map(
      (v): TxRow => ({
        id: `v-${v.id}`,
        kind: 'vault',
        method: v.method,
        points: null,
        balanceAfter: null,
        ghs: v.amount_minor / 100,
        at: v.created_at,
        direction: 'out',
        status: 'settled',
      }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))

  // ---- Daily aggregates, zero-filled so the chart never interpolates over
  // missing days as if they were data.
  const byDay = new Map<string, DailyPoint>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const day = d.toISOString().slice(0, 10)
    byDay.set(day, { day, earned: 0, adsWatched: 0 })
  }
  for (const e of chartRes.data ?? []) {
    const day = e.created_at.slice(0, 10)
    const point = byDay.get(day)
    if (!point) continue
    if (e.amount > 0) point.earned += e.amount
    /*
      Surveys count. They are `survey` in the ledger and `ad_view` for a video,
      but BOTH increment daily_earning_counters.ads_completed — so the daily
      cap has always counted them, and counting only ad_view here made Home
      contradict itself: the "Ads today" stat (which reads the counter) said 6
      while this chart said 4 for the same day.
    */
    if (e.entry_type === 'ad_view' || e.entry_type === 'survey') point.adsWatched += 1
  }

  return { feed, daily: [...byDay.values()] }
}
