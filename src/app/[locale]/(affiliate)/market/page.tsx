import type { Metadata } from 'next'

import {
  AlertTriangle,
  ChartColumnBig,
  ChevronRight,
  Clock,
  PauseCircle,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AffiliateHeader } from '@/components/affiliate/AffiliateHeader'
import { EarningsPanel } from '@/components/affiliate/EarningsPanel'
import { JoinPanel } from '@/components/affiliate/JoinPanel'
import { PeriodPicker } from '@/components/affiliate/PeriodPicker'
import { PerformanceOverview } from '@/components/affiliate/PerformanceOverview'
import { MarketLinks } from '@/components/affiliate/MarketLinks'
import { StatStrip } from '@/components/affiliate/StatStrip'
import { TrainingCard } from '@/components/affiliate/TrainingCard'
import { Card, CardHeader } from '@/components/ui/Card'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { pickDisplayName } from '@/lib/dashboard/display-name'
import {
  getAffiliateDashboard,
  getAffiliatePerformance,
  periodDelta,
} from '@/lib/market/data'
import { getNotifications, getUnreadCount } from '@/lib/notifications/data'
import { serverNow } from '@/lib/server-now'

export const metadata: Metadata = {
  title: 'Affiliate',
  robots: { index: false, follow: false },
}

const ALLOWED_DAYS = [7, 30, 90]

/**
 * The affiliate business's home.
 *
 * ── ONE ROUTE, FIVE SCREENS ──
 *
 * `affiliate_dashboard` returns a `state`, and each state is a genuinely
 * different page, not the same page with a banner on it:
 *
 *   none       never joined       → the offer. There is no dashboard to show.
 *   pending    joined, not active → what is still required, and nothing else
 *   lapsed     entitlement ended  → the balance, and how to get earning again
 *   suspended  stopped by an admin→ the balance, and who to ask
 *   active     the dashboard
 *
 * They share a URL because they are the same DESTINATION — "the affiliate
 * business" — and a person who has not joined should be able to follow a link
 * to /market without hitting a redirect chain that loses where they came from.
 * They do not share a layout, because a dashboard reading four zeros with a
 * "you have not joined" banner above it is worse than no dashboard: it teaches
 * the reader that the figures on this screen might be meaningless.
 */
export default async function AffiliateHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate')

  /* Clamped to the three the picker offers. A hand-typed ?days=100000 is
     harmless in the RPC (it clamps too) but would render a picker with no
     segment selected, which looks broken. */
  const requested = Number((await searchParams).days)
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30

  const [dashboard, profile, notifications, unreadCount] = await Promise.all([
    getAffiliateDashboard(user!.id),
    getProfile(user!.id),
    getNotifications('affiliate', 30),
    getUnreadCount('affiliate'),
  ])

  const { name: pickedName } = pickDisplayName(profile?.full_name)
  const greetName = pickedName ?? t('there')
  const now = serverNow()

  const header = (
    <AffiliateHeader notifications={notifications} unreadCount={unreadCount} now={now} />
  )

  /* ------------------------------------------------------------------ */
  /* Not an affiliate — the offer, and only the offer.                    */
  /* ------------------------------------------------------------------ */
  if (dashboard.state === 'none') {
    return (
      <div className="relative isolate mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
        <div
          aria-hidden
          className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
        />
        {header}
        <JoinPanel offers={dashboard.training_offers ?? []} />
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  /* Joined, but not earning. Three reasons, three different screens.     */
  /* ------------------------------------------------------------------ */
  if (dashboard.state === 'pending' || dashboard.state === 'suspended') {
    const suspended = dashboard.state === 'suspended'
    return (
      <div className="relative isolate mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
        <div
          aria-hidden
          className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
        />
        {header}

        <section
          className={`rounded-(--radius-panel) border px-5 py-6 ${
            suspended ? 'border-danger-500/30 bg-danger-50' : 'border-ink-200 bg-surface'
          }`}
        >
          <span
            aria-hidden
            className={`grid size-11 place-items-center rounded-full ${
              suspended ? 'bg-danger-500/15 text-danger-600' : 'bg-brand-600/15 text-brand-700'
            }`}
          >
            {suspended ? <PauseCircle className="size-5" /> : <Clock className="size-5" />}
          </span>
          <h1 className="mt-3 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
            {t(suspended ? 'suspended.title' : 'pending.title')}
          </h1>
          <p className="mt-2 max-w-lg text-[0.875rem] leading-relaxed text-ink-600">
            {t(suspended ? 'suspended.body' : 'pending.body')}
          </p>
          {!suspended && (dashboard.training ?? []).length > 0 && (
            <div className="mt-5">
              <TrainingCard course={dashboard.training![0]} />
            </div>
          )}
          {suspended && (
            <Link
              href="/support"
              className="mt-5 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
            >
              {t('suspended.contact')}
            </Link>
          )}
        </section>

        {/* ⚠️ AN ACCOUNT WITHOUT A COURSE (operator, 2026-08-12). Until the
            reset, holding an affiliate row meant having bought training, so
            this screen only ever said "finish your training". A pending
            account with nothing bought was told to finish something it had
            never started, with no way to buy it. The programmes belong here
            for exactly that person, and `training_offers` is empty once they
            hold one, so a member is never sold what they already own. */}
        {!suspended && (dashboard.training_offers ?? []).length > 0 && (
          <JoinPanel offers={dashboard.training_offers ?? []} />
        )}
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  /* Active, or lapsed — both get the dashboard, because both have money  */
  /* on the screen. Lapsed adds a banner explaining why nothing new is    */
  /* arriving; it does not hide what has already been earned.             */
  /* ------------------------------------------------------------------ */
  const performance = await getAffiliatePerformance(user!.id, days)
  const lapsed = dashboard.state === 'lapsed'
  const training = dashboard.training ?? []
  /* The one that is furthest from done — that is the one with something left
     to do, which is what the card is for. A finished course would push the
     unfinished one off the screen. */
  const focus = training.slice().sort((a, b) => a.percent - b.percent)[0]

  return (
    <div className="relative isolate mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />
      {header}

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('greeting', { name: greetName })}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      {lapsed && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 px-4 py-3"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4.5 shrink-0 text-warning-600" />
          <div>
            <p className="text-[0.8125rem] font-semibold text-ink-900">{t('lapsed.title')}</p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-600">{t('lapsed.body')}</p>
          </div>
        </div>
      )}

      <EarningsPanel
        earnedMinor={performance.earned_minor}
        balanceMinor={dashboard.balance_minor ?? 0}
        pendingMinor={dashboard.pending_minor ?? 0}
        deltaPercent={periodDelta(performance.earned_minor, performance.prev_earned_minor)}
        days={days}
        series={performance.series}
        payoutsEnabled={dashboard.payouts_enabled ?? false}
        minimumMinor={dashboard.payout_minimum_minor ?? 0}
        periodSlot={<PeriodPicker days={days} />}
      />

      {/* The same door the ads dashboard has, in the same place relative to
          the balance it explains. Violet rather than blue, because this side
          of the platform wears violet everywhere. */}
      <Link
        href="/commission/breakdown"
        className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3 transition-colors hover:border-ink-300"
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-500/12 text-brand-600"
        >
          <ChartColumnBig className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] font-medium text-ink-900">
            {t('breakdown.title')}
          </span>
          <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-500">
            {t('breakdown.hint')}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-400" />
      </Link>

      <StatStrip
        clicks={performance.clicks}
        customers={performance.visitors}
        conversions={performance.conversions}
      />

      {focus && <TrainingCard course={focus} />}

      <MarketLinks />

      <Card>
        <CardHeader title={t('chart.title')} description={t('chart.description', { n: days })} />
        <PerformanceOverview series={performance.series} />
      </Card>
    </div>
  )
}
