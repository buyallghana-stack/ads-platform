import type { Metadata } from 'next'

import { Gift, PlayCircle, TrendingUp, Trophy } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { PerformanceChart } from '@/components/dashboard/PerformanceChart'
import { TransactionHistory } from '@/components/dashboard/TransactionHistory'
import { Card, CardHeader, StatCard as Stat } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Link, redirect } from '@/i18n/navigation'
import { getHomeData } from '@/lib/dashboard/home-data'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Home',
  robots: { index: false, follow: false },
}

/**
 * Home tab (operator brief 2026-07-24): balance hero with the cedi value
 * dominant and points beneath it, a performance chart from tablet up, and
 * the full transaction statement. Composition adapted from the operator's
 * two references (Metoric / Social Orbit) — stat row + one main chart +
 * table — with their sales-analytics furniture removed.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('dashboard')
  const format = await getFormatter()

  const admin = createAdminClient()
  const [{ data: status }, { data: profile }, { data: balances }, { feed, daily }] =
    await Promise.all([
      // SECURITY DEFINER with its own authorisation check (§8).
      admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
      supabase.from('profiles').select('full_name, referral_code').eq('id', user!.id).maybeSingle(),
      supabase.from('user_balances').select('lifetime_earned').eq('user_id', user!.id).maybeSingle(),
      getHomeData(user!.id),
    ])

  const balance = status?.balance ?? 0
  const currency = Number(status?.currency_value ?? 0)
  const cap = status?.daily_ad_cap ?? 0
  const done = status?.ads_completed_today ?? 0
  const remaining = status?.ads_remaining_today ?? 0
  const firstName = (profile?.full_name ?? '').split(' ')[0] || t('there')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div>
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">
          {t('greeting', { name: firstName })}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      {status?.account_disabled && (
        <div
          role="alert"
          className="rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700"
        >
          {t('accountDisabled')}
        </div>
      )}
      {status?.earning_paused && !status?.account_disabled && (
        <div
          role="status"
          className="rounded-(--radius-card) border border-warning-500/25 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-600"
        >
          {t('earningPaused')}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Balance hero — the cedi value is the headline, points beneath      */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-label={t('balance')}
        className="relative isolate overflow-hidden rounded-(--radius-panel) bg-gradient-to-br from-brand-600 to-(--color-brand-accent) px-5 py-6 text-white shadow-[0_1px_2px_rgb(15_23_42/0.06),0_16px_40px_-16px_rgb(0_58_134/0.5)] sm:px-7"
      >
        {/* Decorative field, echoing the auth panel's treatment: two soft
            light pools plus a hairline ring drifting off the corner — the
            payment-card texture every fintech hero leans on, kept faint. */}
        <div
          aria-hidden
          className="absolute -right-16 -top-24 -z-10 size-64 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-28 -left-10 -z-10 size-56 rounded-full bg-brand-950/25 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -right-10 -top-16 -z-10 size-56 rounded-full border border-white/15"
        />
        <div
          aria-hidden
          className="absolute -right-2 -top-8 -z-10 size-32 rounded-full border border-white/10"
        />
        <p className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-white/70">
          {t('balance')}
        </p>
        <p className="mt-1.5 text-[2.375rem] font-bold leading-none tracking-[-0.02em] tabular-nums sm:text-[2.75rem]">
          <span className="mr-1.5 align-top text-[1.125rem] font-semibold leading-[1.9] text-white/80 sm:text-[1.25rem]">
            GHS
          </span>
          {format.number(currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="mt-2 text-[0.875rem] font-medium tabular-nums text-white/85">
          {t('pointsAccumulated', { points: format.number(balance) })}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/ads">
            <Button
              size="md"
              className="border-white/25 bg-surface text-brand-700 shadow-none hover:border-white hover:bg-surface hover:text-brand-800 active:bg-brand-50"
              leadingIcon={<PlayCircle />}
            >
              {t('watchCta')}
            </Button>
          </Link>
          <span className="text-[0.8125rem] text-white/75">
            {t('remaining', { count: remaining })}
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Stat row                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('adsToday')}
          value={`${done} / ${cap}`}
          sublabel={t('remaining', { count: remaining })}
          icon={<PlayCircle />}
          tone="brand"
        />
        <Stat label={t('tier')} value={status?.tier_name ?? '—'} icon={<Trophy />} tone="violet" />
        <Stat
          label={t('lifetimeEarned')}
          value={format.number(balances?.lifetime_earned ?? 0)}
          sublabel={t('lifetimeEarnedHint')}
          icon={<TrendingUp />}
          tone="success"
        />
        <Stat
          label={t('referralCode')}
          value={<span className="tracking-[0.12em]">{profile?.referral_code ?? '—'}</span>}
          sublabel={t('referralHint')}
          icon={<Gift />}
          tone="orange"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Performance chart — tablet and desktop only (2026-07-24 decision)  */}
      {/* ------------------------------------------------------------------ */}
      <Card className="hidden md:block">
        <CardHeader title={t('chart.title')} description={t('chart.description')} />
        <PerformanceChart daily={daily} />
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Transaction history                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader title={t('history.title')} description={t('history.description')} />
        <TransactionHistory rows={feed} />
      </Card>
    </div>
  )
}
