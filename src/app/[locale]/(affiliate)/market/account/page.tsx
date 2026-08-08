import type { Metadata } from 'next'

import {
  CalendarClock,
  ChevronRight,
  FileText,
  Layers,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { CertificatesPanel } from '@/components/affiliate/CertificatesPanel'
import { CopyCode } from '@/components/affiliate/CopyCode'
import { RecruitPanel } from '@/components/affiliate/RecruitPanel'
import { UpgradePanel, type UpgradeOffer } from '@/components/affiliate/UpgradePanel'
import { ModeSwitchCard } from '@/components/app/ModeSwitch'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { getAffiliateDashboard, getMyLearning, getShopProducts } from '@/lib/market/data'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrigin } from '@/lib/request-context'
import { cn } from '@/lib/cn'

export const metadata: Metadata = {
  title: 'Affiliate account',
  robots: { index: false, follow: false },
}

/**
 * Who this account is inside the affiliate business.
 *
 * Deliberately NOT a second profile screen. Name, email, password, payout
 * details, two-factor and log out all live on the ads-side Profile and are
 * account-wide — duplicating any of them here would give the same setting two
 * homes that can disagree. This screen carries only what is true of the
 * AFFILIATE account: its code, its programme, when access ends, and how deep
 * commission runs.
 *
 * ── THE EXPIRY IS THE POINT OF THIS SCREEN ──
 *
 * Entitlements last a year and then stop paying. Nothing else in the app tells
 * anybody when that is, and the day it lapses their links quietly stop earning
 * — the failure is invisible from the outside. So the remaining days are given
 * a card of their own, and they change colour as the date approaches rather
 * than only on the day it passes.
 */
export default async function AffiliateAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.account')
  const format = await getFormatter()

  const [dashboard, profile, origin, learning, upgrade] = await Promise.all([
    getAffiliateDashboard(user!.id),
    getProfile(user!.id),
    getOrigin(),
    getMyLearning(user!.id),
    /* The level above whatever they hold, or null. The read decides, so no
       screen has to remember that Beginner stops being an offer once
       Professional is bought. */
    createAdminClient()
      .rpc('training_upgrade_offer', { p_user_id: user!.id })
      .then((r) => (r.data ?? null) as UpgradeOffer | null),
  ])

  /* The training programmes, with this affiliate's own code on each link and
     the rate the programme actually pays. Read from the shop rather than
     assumed: a panel advertising a percentage the ledger does not pay is
     worse than no panel. */
  const recruitLinks = dashboard.code
    ? (await getShopProducts(user!.id))
        .filter((p) => p.purpose === 'training_program')
        .map((p) => ({
          title: p.title,
          url: `${origin}/${locale}/p/${p.slug}?ref=${dashboard.code}`,
          l1Rate: p.l1_rate,
          priceGhs: p.price_minor / 100,
        }))
    : []

  const daysLeft = dashboard.days_left ?? null
  /* Three bands, not two. "Expired" is obvious the day it happens; the useful
     warning is the one that arrives while there is still time to renew. */
  const urgency =
    daysLeft === null ? 'none' : daysLeft <= 0 ? 'over' : daysLeft <= 30 ? 'soon' : 'fine'

  return (
    <div className="relative isolate mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      {/* ── who ──────────────────────────────────────────────────────── */}
      <section className="flex items-center gap-3.5 rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-600/15 text-brand-700"
        >
          <UserRound className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-semibold text-ink-900">
            {profile?.full_name ?? t('noName')}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-ink-500">
            {dashboard.tier
              ? t(`tier.${dashboard.tier}`)
              : t('noProgramme')}
          </p>
        </div>
      </section>

      {/* ── the code ─────────────────────────────────────────────────── */}
      {dashboard.code && <CopyCode code={dashboard.code} origin={origin} locale={locale} />}

      {/* The training is a product, so a link to it carrying this affiliate's
          code is a real attributable link — and what it sells is the thing that
          turns the person clicking it into another affiliate. */}
      {dashboard.code && <RecruitPanel programmes={recruitLinks} />}

      {/* Training is a subscription, so the level above yours is offered here
          beside the one you hold rather than on the products screen. */}
      <UpgradePanel offer={upgrade} />

      {/* A certificate is a document you hold, not a course. It lives with the
          rest of what you hold, and no longer on Learn. */}
      <CertificatesPanel certificates={learning.certificates} />

      {/* ── access and depth ─────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section
          className={cn(
            'rounded-(--radius-panel) border p-4',
            urgency === 'over'
              ? 'border-danger-500/30 bg-danger-50'
              : urgency === 'soon'
                ? 'border-warning-500/30 bg-warning-50'
                : 'border-ink-200 bg-surface',
          )}
        >
          <p className="flex items-center gap-1.5 text-[0.75rem] font-medium uppercase tracking-[0.06em] text-ink-500">
            <CalendarClock aria-hidden className="size-3.5" />
            {t('accessTitle')}
          </p>
          {daysLeft === null ? (
            <p className="mt-1.5 text-[0.875rem] text-ink-600">{t('noAccess')}</p>
          ) : (
            <>
              <p className="mt-1 text-[1.5rem] font-bold leading-none tabular-nums text-ink-900">
                {t('daysLeft', { n: daysLeft })}
              </p>
              {dashboard.expires_at && (
                <p className="mt-1.5 text-[0.75rem] text-ink-500">
                  {t('until', {
                    date: format.dateTime(new Date(dashboard.expires_at), {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }),
                  })}
                </p>
              )}
            </>
          )}
        </section>

        <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
          <p className="flex items-center gap-1.5 text-[0.75rem] font-medium uppercase tracking-[0.06em] text-ink-500">
            <Layers aria-hidden className="size-3.5" />
            {t('depthTitle')}
          </p>
          <p className="mt-1 text-[1.5rem] font-bold leading-none tabular-nums text-ink-900">
            {dashboard.depth ?? 0}
          </p>
          <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-500">
            {(dashboard.depth ?? 0) >= 2 ? t('depthTwo') : t('depthOne')}
          </p>
        </section>
      </div>

      {/* ── what they agreed to ──────────────────────────────────────
          H47: no separate affiliate agreement is drafted, but WHICH VERSION
          somebody accepted is recorded, because that cannot be reconstructed
          later. Shown to them, not just stored, since a record nobody can see
          is a record nobody can check. */}
      <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
        <p className="flex items-center gap-1.5 text-[0.75rem] font-medium tracking-[0.06em] text-ink-500 uppercase">
          <FileText aria-hidden className="size-3.5" />
          {t('termsTitle')}
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-700">
          {dashboard.terms_accepted_at
            ? t('termsAccepted', {
                version: dashboard.terms_version ?? 1,
                date: format.dateTime(new Date(dashboard.terms_accepted_at), {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                }),
              })
            : t('termsUnrecorded')}
        </p>
        <Link
          href="/terms"
          className="mt-2 inline-block text-[0.8125rem] font-semibold text-brand-700 hover:underline"
        >
          {t('termsLink')}
        </Link>
      </section>

      {/* ── things that live on the other side ───────────────────────── */}
      <section className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
        <p className="border-b border-ink-200 px-4 py-3 text-[0.8125rem] font-semibold text-ink-900">
          {t('elsewhereTitle')}
        </p>
        <ul className="divide-y divide-ink-200">
          {[
            /* `/profile/payout` — `/profile/payout-details` was shipped here and 404s;
               the route it means is the Phase 1 one. */
            { href: '/profile/payout', key: 'payoutDetails', Icon: ShieldCheck },
            { href: '/profile', key: 'profile', Icon: UserRound },
          ].map(({ href, key, Icon }) => (
            <li key={key}>
              <Link
                href={href}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-ink-100"
              >
                <Icon aria-hidden className="size-4.5 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-medium text-ink-900">
                    {t(`${key}.title`)}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-500">
                    {t(`${key}.body`)}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-400" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* On a phone the sidebar's switch is not on screen, and this is the
          screen somebody lands on looking for "the rest of my account". */}
      <div className="md:hidden">
        <ModeSwitchCard to="earn" />
      </div>
    </div>
  )
}
