import type { Metadata } from 'next'

import { Banknote, Clock, Info, Wallet } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { AffiliateHeader } from '@/components/affiliate/AffiliateHeader'
import { StatementList } from '@/components/affiliate/StatementList'
import { Card, CardHeader } from '@/components/ui/Card'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateDashboard, getAffiliateStatement } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { getNotifications, getUnreadCount } from '@/lib/notifications/data'
import { serverNow } from '@/lib/server-now'
import { cn } from '@/lib/cn'

export const metadata: Metadata = {
  title: 'Earnings',
  robots: { index: false, follow: false },
}

const PAYOUT_TONE: Record<string, string> = {
  requested: 'bg-warning-50 text-warning-600',
  approved: 'bg-brand-600/15 text-brand-700',
  paid: 'bg-success-500/15 text-success-600',
  rejected: 'bg-danger-500/15 text-danger-600',
  cancelled: 'bg-ink-100 text-ink-500',
}

/**
 * Earnings: the three balances, the payout queue, and every line behind them.
 *
 * ── THREE FIGURES, AND THEY MUST RECONCILE ON SCREEN ──
 *
 *     earned − reversed − paid  =  balance + pending
 *
 * That identity is what migration 132 was written to restore, after the screen
 * once showed a balance of GHS 248 above "Earned all time: GHS 0.00" — both
 * figures individually correct, and together nonsense. So the summary is laid
 * out as an arithmetic that can be checked by eye rather than as four unrelated
 * tiles: what came in, what went back, what was paid out, what is left.
 *
 * ── AVAILABLE AND PENDING ARE NEVER ADDED ──
 *
 * They are shown side by side and never as one total. The pending figure is
 * money that exists and cannot be touched yet, and a single combined number is
 * how somebody requests a payout for an amount that will be refused.
 */
export default async function CommissionPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.statement')
  const format = await getFormatter()

  const [dashboard, statement, notifications, unreadCount] = await Promise.all([
    getAffiliateDashboard(user!.id),
    getAffiliateStatement(user!.id),
    getNotifications(30),
    getUnreadCount(),
  ])

  const balance = dashboard.balance_minor ?? 0
  const pending = dashboard.pending_minor ?? 0
  const earned = dashboard.earned_minor ?? 0
  const reversed = dashboard.reversed_minor ?? 0
  const paid = dashboard.paid_minor ?? 0
  const minimum = dashboard.payout_minimum_minor ?? 0
  const payoutsEnabled = dashboard.payouts_enabled ?? false
  const canRequest = payoutsEnabled && balance >= minimum

  return (
    <div className="relative isolate mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />
      <AffiliateHeader notifications={notifications} unreadCount={unreadCount} now={serverNow()} />

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      {/* ── available vs pending, and the action ─────────────────────── */}
      <section
        id="payouts"
        className="rounded-(--radius-panel) border border-ink-200 bg-surface p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1.5 text-[0.75rem] font-medium uppercase tracking-[0.06em] text-ink-500">
              <Wallet aria-hidden className="size-3.5" />
              {t('available')}
            </p>
            <p className="mt-1 text-[2rem] font-bold leading-none tabular-nums text-ink-900">
              {cedis(balance)}
            </p>
          </div>
          <div className="sm:border-l sm:border-ink-200 sm:pl-4">
            <p className="flex items-center gap-1.5 text-[0.75rem] font-medium uppercase tracking-[0.06em] text-ink-500">
              <Clock aria-hidden className="size-3.5" />
              {t('pending')}
            </p>
            <p className="mt-1 text-[2rem] font-bold leading-none tabular-nums text-ink-500">
              {cedis(pending)}
            </p>
            <p className="mt-1 text-[0.75rem] leading-snug text-ink-500">{t('pendingHint')}</p>
          </div>
        </div>

        <div className="mt-5 border-t border-ink-200 pt-4">
          {canRequest ? (
            <Link
              href="/withdraw"
              className="inline-flex items-center gap-2 rounded-(--radius-input) bg-brand-600 px-5 py-3 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
            >
              <Banknote aria-hidden className="size-4" />
              {t('request')}
            </Link>
          ) : (
            <p className="flex items-start gap-2 text-[0.8125rem] leading-snug text-ink-500">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {payoutsEnabled
                ? t('belowMinimum', { amount: cedis(minimum) })
                : t('payoutsClosed')}
            </p>
          )}
        </div>
      </section>

      {/* ── the arithmetic ───────────────────────────────────────────── */}
      <section className="grid grid-cols-3 rounded-(--radius-panel) border border-ink-200 bg-surface">
        {[
          { key: 'earnedAll', value: earned, tone: 'text-success-600' },
          { key: 'reversedAll', value: reversed, tone: 'text-danger-600' },
          { key: 'paidAll', value: paid, tone: 'text-ink-900' },
        ].map(({ key, value, tone }, i) => (
          <div key={key} className={cn('px-3 py-4 text-center', i > 0 && 'border-l border-ink-200')}>
            <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-ink-500">{t(key)}</p>
            <p className={cn('mt-1 text-[0.9375rem] font-semibold tabular-nums', tone)}>
              {cedis(Math.abs(value))}
            </p>
          </div>
        ))}
      </section>

      {/* ── payout requests ──────────────────────────────────────────── */}
      {statement.payouts.length > 0 && (
        <Card>
          <CardHeader title={t('payoutsTitle')} description={t('payoutsDescription')} />
          <ul className="divide-y divide-ink-200">
            {statement.payouts.map((payout) => (
              <li key={payout.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.875rem] font-medium text-ink-900">
                    {/* The NET is the headline, not the gross. What lands in
                        somebody's wallet is the net, and that is the figure
                        they will check this row against. */}
                    {cedis(payout.net_minor)}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-ink-500">
                    {payout.fee_minor > 0
                      ? t('afterFee', {
                          gross: cedis(payout.amount_minor),
                          fee: cedis(payout.fee_minor),
                        })
                      : cedis(payout.amount_minor)}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-ink-400">
                    {format.dateTime(new Date(payout.created_at), {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                  {payout.failure_reason && (
                    <p className="mt-1 text-[0.75rem] text-danger-600">{payout.failure_reason}</p>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold',
                    PAYOUT_TONE[payout.status] ?? PAYOUT_TONE.cancelled,
                  )}
                >
                  {t(`payoutStatus.${payout.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── every line ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t('historyTitle')} description={t('historyDescription')} />
        <StatementList entries={statement.entries} />
      </Card>
    </div>
  )
}
