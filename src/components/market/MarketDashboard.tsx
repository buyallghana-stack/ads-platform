import { ArrowRight, Copy, Wallet } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/Badge'
import { Link } from '@/i18n/navigation'
import { MarketHeader } from '@/components/market/MarketHeader'
import { ProgressToActivation } from '@/components/market/ProgressToActivation'
import { StatTile } from '@/components/market/StatTile'
import {
  ExpiryNotice,
  NegativeBalanceNotice,
  SuspendedNotice,
} from '@/components/market/StateNotices'
import { TrainingOffers } from '@/components/market/TrainingOffers'
import type { AffiliateDashboard } from '@/lib/market/data'
import { cedis, conversionRate, earningsPerClick } from '@/lib/market/money'

/**
 * The affiliate dashboard.
 *
 * Five states, and the design brief for this screen was that four of them have
 * no reference to copy (DESIGN.md call 6). What each state leads with:
 *
 *   none       the two training courses. Not an error — the mode switch is
 *              visible to everyone, so everyone can arrive here.
 *   pending    progress to activation. NOT a grid of zeroes.
 *   active     money, then performance.
 *   lapsed     renewal, with the balance still shown; money already earned is
 *              not forfeit and the screen must not imply it is.
 *   suspended  who to contact.
 *
 * The state is decided in Postgres and arrives as one string, so this component
 * switches rather than infers. A UI that derived it from a scatter of nullable
 * fields is how somebody ends up seeing "pending" and a withdraw button at the
 * same time.
 */
export async function MarketDashboard({ data }: { data: AffiliateDashboard }) {
  const t = await getTranslations('market.dashboard')

  if (data.state === 'none') {
    return (
      <>
        <MarketHeader title={t('none.title')} description={t('none.body')} />
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
          <TrainingOffers offers={data.training_offers ?? []} />
        </div>
      </>
    )
  }

  const balance = data.balance_minor ?? 0
  const negative = balance < 0
  const clicks = data.clicks_30d ?? 0
  const conversions = data.conversions_30d ?? 0
  const earned = data.earned_minor ?? 0
  const minimum = data.payout_minimum_minor ?? 0

  /*
    The withdraw button appears only when it would actually work. Offering a
    control that refuses is worse than not offering it: the refusal arrives
    after the tap, by which point the person has already decided the money is
    theirs to take.
  */
  const canWithdraw =
    data.state === 'active' && (data.payouts_enabled ?? false) && balance >= minimum && minimum > 0

  return (
    <>
      <MarketHeader title={t('title')} />

      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6 md:px-8 md:py-7">
        {data.state === 'suspended' && (
          <SuspendedNotice
            labels={{
              title: t('suspended.title'),
              body: t('suspended.body'),
              contact: t('suspended.contact'),
            }}
          />
        )}

        {negative && (
          <NegativeBalanceNotice
            amount={cedis(balance)}
            labels={{
              title: t('negative.title'),
              why: t('negative.why', { amount: cedis(data.reversed_minor ?? 0) }),
              effect: t('negative.effect'),
              reassure: t('negative.reassure'),
            }}
          />
        )}

        {data.state === 'active' &&
          typeof data.days_left === 'number' &&
          data.days_left <= 30 && (
            <ExpiryNotice
              daysLeft={data.days_left}
              labels={{
                title: t('expiring.title', { days: data.days_left }),
                body: t('expiring.body'),
                renew: t('expiring.renew'),
              }}
            />
          )}

        {data.state === 'lapsed' && (
          <ExpiryNotice
            daysLeft={0}
            labels={{
              title: t('lapsed.title'),
              body: t('lapsed.body'),
              renew: t('lapsed.renew'),
            }}
          />
        )}

        {/* PENDING leads with the course, and shows no statistics at all.
            There is nothing true to put in them yet. */}
        {data.state === 'pending' ? (
          <>
            {(data.training ?? []).map((course) => (
              <ProgressToActivation
                key={course.product_id}
                course={course}
                labels={{
                  toGo: t('pending.toGo', {
                    n: Math.max(0, course.threshold - course.percent),
                  }),
                  unlocked: t('pending.unlocked'),
                  complete: t('pending.complete'),
                  threshold: t('pending.threshold', { n: course.threshold }),
                }}
              />
            ))}
            <Link
              href="/learn"
              className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-jade-600/25 bg-jade-50 px-4 py-3.5 transition-colors hover:border-jade-600/50"
            >
              <span className="text-sm font-semibold text-jade-700">{t('pending.continue')}</span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-jade-700" />
            </Link>
          </>
        ) : (
          <>
            {/* MONEY FIRST. Commission only — there is no points figure
                anywhere in Market mode, which is what makes D27 structural
                rather than a rule somebody has to remember. */}
            <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-ink-500">{t('balance')}</p>
                  <p
                    className={`mt-1 text-[2rem] leading-none font-semibold tabular-nums tracking-[-0.03em] ${
                      negative ? 'text-danger-700' : 'text-ink-900'
                    }`}
                  >
                    {cedis(balance)}
                  </p>
                </div>
                {data.tier && (
                  <Badge tone="neutral" className="shrink-0 capitalize">
                    {data.tier}
                  </Badge>
                )}
              </div>

              {canWithdraw ? (
                <Link
                  href="/commission/withdraw"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-(--radius-input) bg-jade-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-jade-700"
                >
                  <Wallet aria-hidden className="size-4" />
                  {t('withdraw')}
                </Link>
              ) : (
                /* Says WHY, rather than showing a dead button. The three
                   reasons are different problems with different fixes, and
                   "Withdraw (disabled)" tells you which one you have. */
                <p className="mt-3 text-[0.8125rem] leading-snug text-ink-500">
                  {!(data.payouts_enabled ?? false)
                    ? t('payoutsOff')
                    : negative
                      ? t('payoutsBlocked')
                      : t('belowMinimum', { min: cedis(minimum) })}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label={t('stats.earned')}
                value={cedis(earned)}
                tone={earned > 0 ? 'success' : 'neutral'}
                hint={t('stats.earnedHint')}
              />
              <StatTile
                label={t('stats.clicks')}
                value={clicks > 0 ? clicks.toLocaleString('en-GH') : null}
                empty={t('stats.noClicks')}
                hint={t('stats.window')}
              />
              {/* The rate is the hint only when there IS a rate to report.
                  "No sales yet" above "0.0%" says the same thing twice, and the
                  second one says it in a way that looks like a failing grade. */}
              <StatTile
                label={t('stats.conversions')}
                value={conversions > 0 ? conversions.toLocaleString('en-GH') : null}
                empty={t('stats.noConversions')}
                hint={
                  conversions > 0 ? (conversionRate(conversions, clicks) ?? undefined) : t('stats.window')
                }
              />
              {/* Earnings per click is the metric affiliates actually judge
                  themselves on — a raw click count has no denominator and
                  says nothing about whether promoting is working. */}
              <StatTile
                label={t('stats.epc')}
                value={earningsPerClick(earned, clicks)}
                empty={t('stats.noClicks')}
                hint={t('stats.epcHint')}
              />
            </div>

            <Link
              href="/links"
              className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 transition-colors hover:border-ink-300"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Copy aria-hidden className="size-4 shrink-0 text-ink-500" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-900">
                    {t('links.title')}
                  </span>
                  <span className="block truncate text-[0.75rem] text-ink-500">
                    {t('links.code', { code: data.code ?? '' })}
                  </span>
                </span>
              </span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-400" />
            </Link>

            {/* Course progress is shown in EVERY state, not only pending: an
                active affiliate who stopped at 60% still has a certificate
                waiting at 100%. */}
            {(data.training ?? [])
              .filter((c) => c.percent < 100)
              .map((course) => (
                <ProgressToActivation
                  key={course.product_id}
                  course={course}
                  labels={{
                    toGo: t('pending.toGo', {
                      n: Math.max(0, course.threshold - course.percent),
                    }),
                    unlocked: t('pending.unlocked'),
                    complete: t('pending.complete'),
                    threshold: t('pending.threshold', { n: course.threshold }),
                  }}
                />
              ))}
          </>
        )}
      </div>
    </>
  )
}
