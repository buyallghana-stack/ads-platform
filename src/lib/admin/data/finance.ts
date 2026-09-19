import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { DailyMoney, FinanceRow, OverviewMetrics } from '../types'

/**
 * The money figures behind Overview and Finance, for real.
 *
 * NOTHING HERE IS STORED. Every number is derived from the rows that justify
 * it — confirmed subscription payments, advertiser receipts, redemptions with
 * a `paid_at` — so there is no total that can drift from its own evidence and
 * no cache to invalidate when an operator corrects a mis-keyed receipt.
 *
 * The arithmetic lives in SQL rather than here on purpose. Overview, Finance
 * and the chart all answer the same question over different groupings, and
 * three TypeScript reducers over three different fetches is three chances for
 * the deposits on one screen to disagree with the deposits on another.
 */

/**
 * `changePct` is NULL from the database when the previous window was empty.
 *
 * Kept as null all the way to the component rather than coerced to 0: going
 * from nothing to GHS 740 is not "no change" and it is not "+100%", it is a
 * comparison that cannot be made, and the card renders no trend at all. A
 * platform in its first weeks would otherwise show a wall of invented
 * percentages.
 */
type TrendRow = { value: number | string; changePct: number | string | null }

const trend = (t: TrendRow) => ({
  value: Number(t.value),
  changePct: t.changePct === null ? null : Number(t.changePct),
})

/** The shape `admin_overview_metrics` returns, before numbers are unwrapped. */
type MetricsJson = {
  deposits: TrendRow & {
    subscriptions: number | string
    advertisers: number | string
    vault: number | string
  }
  withdrawals: TrendRow
  profit: TrendRow
  liability: { points: number | string; ghs: number | string }
  users: TrendRow & { newToday: number }
  subscriptions: TrendRow & { active: number }
  pendingPayouts: { count: number; ghs: number | string }
  adsLive: { total: number; videos: number; surveys: number; links: number }
}

export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_overview_metrics')

  if (error) throw new Error(`Could not load the overview: ${error.message}`)

  const m = data as unknown as MetricsJson

  return {
    deposits: {
      ...trend(m.deposits),
      subscriptions: Number(m.deposits.subscriptions),
      advertisers: Number(m.deposits.advertisers),
      /* Its own line, never folded into the other two. A subscription is
         revenue; a vault deposit is cash in with a return contracted against
         it. Counted in the total because it IS money that arrived, split out
         because they are not the same promise. */
      vault: Number(m.deposits.vault ?? 0),
    },
    withdrawals: trend(m.withdrawals),
    profit: trend(m.profit),
    liability: { points: Number(m.liability.points), ghs: Number(m.liability.ghs) },
    users: { ...trend(m.users), newToday: m.users.newToday },
    subscriptions: { ...trend(m.subscriptions), active: m.subscriptions.active },
    pendingPayouts: { count: m.pendingPayouts.count, ghs: Number(m.pendingPayouts.ghs) },
    adsLive: m.adsLive,
  }
}

export async function getFinanceRows(months = 12): Promise<FinanceRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_finance_statement', { p_months: months })

  if (error) throw new Error(`Could not load the statement: ${error.message}`)

  return (
    (data ?? []) as unknown as {
      month: string
      subscriptions_ghs: number | string
      advertisers_ghs: number | string
      vault_ghs: number | string
      withdrawals_ghs: number | string
    }[]
  ).map((row) => ({
    month: row.month,
    subscriptionsGhs: Number(row.subscriptions_ghs),
    advertisersGhs: Number(row.advertisers_ghs),
    vaultGhs: Number(row.vault_ghs ?? 0),
    withdrawalsGhs: Number(row.withdrawals_ghs),
  }))
}

/**
 * The chart series. Only ever fetched for a screen wide enough to draw it —
 * the operator's rule is no charts below `md`, and the page does not render
 * the component there rather than hiding it with CSS.
 */
export async function getDailyMoney(days = 30): Promise<DailyMoney[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_daily_money', { p_days: days })

  if (error) throw new Error(`Could not load the money series: ${error.message}`)

  return (
    (data ?? []) as unknown as {
      day: string
      deposits: number | string
      withdrawals: number | string
    }[]
  ).map((row) => ({
    day: row.day,
    deposits: Number(row.deposits),
    withdrawals: Number(row.withdrawals),
  }))
}
