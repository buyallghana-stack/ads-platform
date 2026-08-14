import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type VaultPlan = {
  id: string
  name: string
  description: string | null
  priceMinor: number
  currencyCode: string
  periodDays: number
  dailyReturnPercent: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type VaultInvestment = {
  id: string
  userId: string
  planId: string
  planName: string
  amountMinor: number
  currencyCode: string
  dailyReturnPercent: number
  periodDays: number
  startedAt: string
  endsAt: string
  status: 'active' | 'claimed'
  expectedProfitMinor: number
  expectedReturnMinor: number
  paymentId: string | null
  claimedAt: string | null
  claimedPoints: number | null
  createdAt: string
}

export const getVaultEnabled = cache(async (): Promise<boolean> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'vault_enabled')
    .maybeSingle()

  return data?.value === 'true'
})

export const getVaultPlans = cache(async (): Promise<VaultPlan[]> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('vault_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const rows = data ?? []
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    priceMinor: Number(r.price_minor),
    currencyCode: r.currency_code,
    periodDays: Number(r.period_days),
    dailyReturnPercent: Number(r.daily_return_percent),
    isActive: Boolean(r.is_active),
    sortOrder: Number(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
})

export const getUserVaultInvestments = cache(
  async (userId: string): Promise<VaultInvestment[]> => {
    const supabase = await createClient()
    const { data } = await supabase
      .from('vault_investments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    const rows = data ?? []
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      planId: r.plan_id,
      planName: r.plan_name,
      amountMinor: Number(r.amount_minor),
      currencyCode: r.currency_code,
      dailyReturnPercent: Number(r.daily_return_percent),
      periodDays: Number(r.period_days),
      startedAt: r.started_at,
      endsAt: r.ends_at,
      status: r.status as 'active' | 'claimed',
      expectedProfitMinor: Number(r.expected_profit_minor),
      expectedReturnMinor: Number(r.expected_return_minor),
      paymentId: r.payment_id,
      claimedAt: r.claimed_at,
      claimedPoints: r.claimed_points ? Number(r.claimed_points) : null,
      createdAt: r.created_at,
    }))
  },
)

export async function getAllVaultPlansAdmin(): Promise<VaultPlan[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('vault_plans')
    .select('*')
    .order('sort_order', { ascending: true })

  const rows = data ?? []
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    priceMinor: Number(r.price_minor),
    currencyCode: r.currency_code,
    periodDays: Number(r.period_days),
    dailyReturnPercent: Number(r.daily_return_percent),
    isActive: Boolean(r.is_active),
    sortOrder: Number(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export async function getAllVaultInvestmentsAdmin(): Promise<(VaultInvestment & { userEmail?: string; userFullName?: string })[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('vault_investments')
    .select(`
      *,
      profiles:user_id (
        full_name
      )
    `)
    .order('created_at', { ascending: false })

  const rows = (data ?? []) as unknown as Array<{
    id: string
    user_id: string
    plan_id: string
    plan_name: string
    amount_minor: number | string
    currency_code: string
    daily_return_percent: number | string
    period_days: number | string
    started_at: string
    ends_at: string
    status: string
    expected_profit_minor: number | string
    expected_return_minor: number | string
    payment_id: string | null
    claimed_at: string | null
    claimed_points: number | string | null
    created_at: string
    profiles?: { full_name?: string | null } | null
  }>

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    planId: r.plan_id,
    planName: r.plan_name,
    amountMinor: Number(r.amount_minor),
    currencyCode: r.currency_code,
    dailyReturnPercent: Number(r.daily_return_percent),
    periodDays: Number(r.period_days),
    startedAt: r.started_at,
    endsAt: r.ends_at,
    status: r.status as 'active' | 'claimed',
    expectedProfitMinor: Number(r.expected_profit_minor),
    expectedReturnMinor: Number(r.expected_return_minor),
    paymentId: r.payment_id,
    claimedAt: r.claimed_at,
    claimedPoints: r.claimed_points ? Number(r.claimed_points) : null,
    createdAt: r.created_at,
    userFullName: r.profiles?.full_name ?? undefined,
  }))
}
