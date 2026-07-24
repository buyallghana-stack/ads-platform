import type { Metadata } from 'next'

import { ArrowUpRight, PlayCircle, TrendingUp, Trophy } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { LogOutButton } from '@/components/app/LogOutButton'
import { Logo } from '@/components/brand/Logo'
import { PerformanceChart } from '@/components/dashboard/PerformanceChart'
import { ReferralCard } from '@/components/dashboard/ReferralCard'
import { TransactionHistory } from '@/components/dashboard/TransactionHistory'
import { ThemeSwitchButton } from '@/components/theme/ThemeSwitchButton'
import { Card, CardHeader, StatCard as Stat } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getSessionUser } from '@/lib/auth/session'
import { pickDisplayName } from '@/lib/dashboard/display-name'
import { getHomeData } from '@/lib/dashboard/home-data'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/cn'

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

  // Deduplicated with the (app) layout: same request, so getUser and the
  // profile fetch resolve from React's cache rather than repeating.
  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('dashboard')
  const format = await getFormatter()

  const admin = createAdminClient()
  const [{ data: status }, profile, { data: balances }, { feed, daily }] = await Promise.all([
    // SECURITY DEFINER with its own authorisation check (§8).
    admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
    getProfile(user!.id),
    admin.from('user_balances').select('lifetime_earned').eq('user_id', user!.id).maybeSingle(),
    getHomeData(user!.id),
  ])

  const balance = status?.balance ?? 0
  const currency = Number(status?.currency_value ?? 0)
  const cap = status?.daily_ad_cap ?? 0
  const done = status?.ads_completed_today ?? 0
  const remaining = status?.ads_remaining_today ?? 0
  const { name: pickedName, sizeClass } = pickDisplayName(profile?.full_name)
  const greetName = pickedName ?? t('there')

  // "This week" rail summary, computed from the same daily aggregates the
  // chart uses — one source of truth, no second query.
  const week = daily.slice(-7)
  const weekEarned = week.reduce((sum, d) => sum + d.earned, 0)
  const weekAds = week.reduce((sum, d) => sum + d.adsWatched, 0)
  const bestDay = week.reduce((best, d) => (d.earned > best.earned ? d : best), week[0])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      {/* Home-only header: brand (mobile — the sidebar carries it on md+),
          theme switch and the red icon-only logout. Other tabs get none of
          this chrome (operator direction 2026-07-24). */}
      <header className="flex items-center gap-3">
        <Logo variant="dark" className="md:hidden" />
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeSwitchButton />
          <LogOutButton />
        </div>
      </header>

      <div className="animate-rise">
        <h1
          className={cn(
            'font-semibold tracking-[-0.02em] break-words text-ink-900',
            sizeClass,
          )}
        >
          {t('greeting', { name: greetName })}{' '}
          <span aria-hidden>🤗</span>
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
        style={{ '--rise-delay': '0.06s' } as React.CSSProperties}
        className="animate-rise relative isolate overflow-hidden rounded-(--radius-panel) bg-gradient-to-br from-brand-600 to-(--color-brand-accent) px-5 py-6 text-white shadow-[0_1px_2px_rgb(15_23_42/0.06),0_16px_40px_-16px_rgb(0_58_134/0.5)] sm:px-7"
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
          <Link href="/withdraw">
            <Button
              size="md"
              className="border-white/30 bg-white/10 text-white shadow-none hover:border-white/60 hover:bg-white/15 hover:text-white active:bg-white/20"
              leadingIcon={<ArrowUpRight />}
            >
              {t('withdrawCta')}
            </Button>
          </Link>
          <span className="text-[0.8125rem] text-white/75">
            {t('remaining', { count: remaining })}
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Stat row — three cards carrying real data visuals: the cap as a    */}
      {/* progress bar, lifetime earnings as a sparkline of the last 14 days */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{ '--rise-delay': '0.12s' } as React.CSSProperties}
        className="animate-rise grid grid-cols-2 gap-3 lg:grid-cols-3"
      >
        <Stat
          label={t('adsToday')}
          value={`${done} / ${cap}`}
          sublabel={t('capResets')}
          icon={<PlayCircle />}
          tone="brand"
          progress={cap > 0 ? done / cap : 0}
        />
        <Stat label={t('tier')} value={status?.tier_name ?? '—'} icon={<Trophy />} tone="violet" />
        <Stat
          label={t('lifetimeEarned')}
          value={format.number(balances?.lifetime_earned ?? 0)}
          sublabel={t('lifetimeEarnedHint')}
          icon={<TrendingUp />}
          tone="success"
          spark={daily.slice(-14).map((d) => d.earned)}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main working area.                                                  */}
      {/*   mobile   rail cards only (no chart — 2026-07-24 decision)         */}
      {/*   tablet   chart full width, rail cards side by side beneath        */}
      {/*   desktop  chart 2/3, rail 1/3 beside it — the reference layout     */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{ '--rise-delay': '0.18s' } as React.CSSProperties}
        className="animate-rise grid items-start gap-5 xl:grid-cols-3"
      >
        <Card className="hidden md:block xl:col-span-2">
          <CardHeader title={t('chart.title')} description={t('chart.description')} />
          <PerformanceChart daily={daily} />
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          {/* This week, from the same aggregates the chart plots. */}
          <Card>
            <CardHeader title={t('week.title')} description={t('week.description')} />
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[0.8125rem] text-ink-500">
                  <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
                  {t('week.earned')}
                </span>
                <span className="text-[0.8125rem] font-semibold tabular-nums text-ink-900">
                  {format.number(weekEarned)} pts
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[0.8125rem] text-ink-500">
                  <span aria-hidden className="size-1.5 rounded-full bg-violet-500" />
                  {t('week.adsWatched')}
                </span>
                <span className="text-[0.8125rem] font-semibold tabular-nums text-ink-900">
                  {weekAds}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[0.8125rem] text-ink-500">
                  <span aria-hidden className="size-1.5 rounded-full bg-brand-500" />
                  {t('week.bestDay')}
                </span>
                <span className="text-[0.8125rem] font-semibold tabular-nums text-ink-900">
                  {bestDay && bestDay.earned > 0
                    ? format.dateTime(new Date(bestDay.day + 'T00:00:00Z'), { weekday: 'long' })
                    : '—'}
                </span>
              </div>
            </div>
          </Card>

          <ReferralCard code={profile?.referral_code ?? null} />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Transaction history                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card
        style={{ '--rise-delay': '0.24s' } as React.CSSProperties}
        className="animate-rise"
      >
        <CardHeader title={t('history.title')} description={t('history.description')} />
        <TransactionHistory rows={feed} />
      </Card>
    </div>
  )
}
