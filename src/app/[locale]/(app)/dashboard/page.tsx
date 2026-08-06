import type { Metadata } from 'next'

import { ArrowUpRight, PlayCircle, TrendingUp, Trophy } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { ModeSwitchButton } from '@/components/app/ModeSwitch'
import { PerformanceChart } from '@/components/dashboard/PerformanceChart'
import { QuickLinks } from '@/components/dashboard/QuickLinks'
import { ReferralCard } from '@/components/dashboard/ReferralCard'
import { TransactionHistory } from '@/components/dashboard/TransactionHistory'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { SupportChatButton } from '@/components/support/SupportChatButton'
import { ThemeSwitchButton } from '@/components/theme/ThemeSwitchButton'
import { Card, CardHeader, StatCard as Stat } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { pickDisplayName } from '@/lib/dashboard/display-name'
import { getHomeData } from '@/lib/dashboard/home-data'
import { getGamesEnabled } from '@/lib/games/data'
import { getNotifications, getUnreadCount } from '@/lib/notifications/data'
import { serverNow } from '@/lib/server-now'
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
  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('dashboard')
  const format = await getFormatter()

  const admin = createAdminClient()
  const [
    { data: status },
    profile,
    { data: balances },
    { feed, daily },
    notifications,
    unreadCount,
    gamesEnabled,
  ] =
    await Promise.all([
      // SECURITY DEFINER with its own authorisation check (§8).
      admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
      getProfile(user!.id),
      admin.from('user_balances').select('lifetime_earned').eq('user_id', user!.id).maybeSingle(),
      getHomeData(user!.id),
      // Own rows via RLS (user client); recent slice feeds the dropdown panel.
      getNotifications(30),
      getUnreadCount(),
      // Cheap public-config read; drives whether the Games tile is live.
      getGamesEnabled(),
    ])
  const now = serverNow()

  const balance = status?.balance ?? 0
  const currency = Number(status?.currency_value ?? 0)
  const cap = status?.daily_ad_cap ?? 0
  const done = status?.ads_completed_today ?? 0
  const remaining = status?.ads_remaining_today ?? 0
  // Resolved across stacked plans and already clamped by the database.
  const multiplier = Number(status?.reward_multiplier ?? 1)
  const { name: pickedName, sizeClass } = pickDisplayName(profile?.full_name)
  const greetName = pickedName ?? t('there')

  // "This week" rail summary, computed from the same daily aggregates the
  // chart uses — one source of truth, no second query.
  const week = daily.slice(-7)
  const weekEarned = week.reduce((sum, d) => sum + d.earned, 0)
  const weekAds = week.reduce((sum, d) => sum + d.adsWatched, 0)
  const bestDay = week.reduce((best, d) => (d.earned > best.earned ? d : best), week[0])

  return (
    <div className="relative isolate mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      {/* The brand wash the hero sits IN rather than on. Fixed height and
          pointer-events-none, so it never intercepts a tap and never grows
          with the page. See `bg-field` in globals.css. */}
      <div aria-hidden className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]" />
      {/* Home-only header: brand (mobile — the sidebar carries it on md+),
          then notifications, theme and support chat. Other tabs get none of
          this chrome (operator direction 2026-07-24).

          Logout was removed from here (operator, 2026-07-25). It still lives
          on Profile, as the red row at the bottom of the settings list, which
          is where every app this audience uses keeps it — and a one-tap sign
          out sitting beside the theme switch is a mis-tap that costs somebody
          their session on a phone. */}
      <header className="flex items-center gap-2">
        <Logo variant="dark" className="md:hidden" />
        {/*
          THE PHONE'S ONLY ROUTE INTO THE SECOND BUSINESS.

          The sidebar carries the same switch, and the sidebar is `md:flex` —
          so without this there is no way into Phase 2 on a phone, which is the
          bug the first mode switch shipped with and which is invisible in the
          source because the component is plainly imported and used.

          `md:hidden` here, because above md the sidebar's card is the better
          affordance and two doors on one screen is one too many.
        */}
        <div className="ml-auto flex items-center gap-2">
        <ModeSwitchButton to="market" className="md:hidden" />
        {/*
          The three icons used to float loose on the wash: no container, no
          edge, nothing saying they belong together or that they are controls
          at all. Against `bg-field` they read as decoration.

          Grouping them in one bordered pill fixes both problems at once — it
          gives the glyphs a surface to sit on so they have contrast wherever
          the gradient happens to be, and it says "toolbar" without adding
          three text labels that would eat the header on a 390px phone.

          The bell keeps a divider after it because it is the only one of the
          three that carries state (the unread badge); the theme switch and
          support chat are stateless twins and sit together.
        */}
        <div className="flex shrink-0 items-center rounded-full border border-ink-200 bg-surface/80 p-0.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] backdrop-blur-sm">
          <NotificationBell notifications={notifications} unreadCount={unreadCount} now={now} />
          <span aria-hidden className="mx-0.5 h-5 w-px bg-ink-200" />
          <ThemeSwitchButton />
          <SupportChatButton />
        </div>
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
        {/*
          WAS the lifetime points total — which also appeared in the "Lifetime
          earned" stat card and again in the week summary. The same figure three
          times on one screen teaches nothing the first one did not.

          What belongs here instead is the only genuinely time-sensitive thing
          on the dashboard: how many ads are left today. It expires at midnight,
          it is what the primary button does, and it was previously six grey
          words beside the buttons.
        */}
        <p className="mt-2 text-[0.875rem] font-medium tabular-nums text-white/85">
          {remaining > 0
            ? t('adsWaiting', { n: remaining })
            : t('capReachedToday')}
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
        </div>
      </section>

      {/* Shortcuts, directly under the balance so they are the first thing a
          thumb reaches. Three are disabled until their features exist. */}
      <QuickLinks
        labels={{
          games: t('quick.games'),
          leaderboard: t('quick.leaderboard'),
          gift: t('quick.gift'),
          tasks: t('quick.tasks'),
        }}
        soonLabel={t('quick.soon')}
        navLabel={t('quick.label')}
        gamesEnabled={gamesEnabled}
      />

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
        {/* The plan NAME alone is a label; the multiplier is what the plan
            actually does. "Gold" tells somebody which box they are in —
            "×2.50 on every ad" tells them why they paid for it.

            It arrives from `get_user_earning_status` (migration 147) rather
            than from a `tiers` read, because stacked subscriptions combine and
            are then clamped: the effective multiplier of a user holding two
            plans is in no single row of that table.

            At ×1 there is nothing to boast about, so the card falls back to the
            cap. Printing "×1.00 on every ad" to a free user would dress the
            absence of a benefit up as one. */}
        <Stat
          label={t('tier')}
          value={status?.tier_name ?? '—'}
          sublabel={
            multiplier > 1
              ? t('tierMultiplier', { x: format.number(multiplier, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
              : cap > 0
                ? t('tierCap', { n: cap })
                : undefined
          }
          icon={<Trophy />}
          tone="violet"
        />
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
