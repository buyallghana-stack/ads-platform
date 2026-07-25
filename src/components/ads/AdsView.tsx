'use client'

import { useState } from 'react'

import { AlertTriangle, ListChecks, PauseCircle, PlayCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { SubmitAdResult } from '@/app/[locale]/(app)/ads/actions'
import type { AdsData, FeedAd } from '@/lib/ads/data'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

import { AdCard } from './AdCard'
import { AdPlayer } from './AdPlayer'
import { CaughtUp } from './CaughtUp'

/**
 * The Ads tab.
 *
 * The operator's shape for this screen: one switch between Videos and Surveys
 * carrying the number of each still to do, a count that goes down as they are
 * done, and a caught-up screen with a countdown when it reaches zero.
 *
 * WHAT THE NUMBER ON THE TAB MEANS
 * --------------------------------
 * Two separate limits can empty a tab and the badge has to respect both:
 *
 *   supply     how many ads of that format are eligible for this user
 *   allowance  ads left in the daily cap, which is SHARED across formats
 *
 * So the badge is min(supply, allowance). Showing supply alone would promise
 * twelve videos to somebody with two ads of allowance left; showing allowance
 * alone would promise twelve when only three videos exist. Because the
 * allowance is shared, finishing a survey lowers the number on Videos too —
 * which is correct, and is why the allowance meter sits above the switch
 * rather than being folded into the badges.
 *
 * WHY THE COUNT MOVES BEFORE THE SERVER SAYS SO
 * ---------------------------------------------
 * A completed ad is removed and the allowance decremented locally the instant
 * the server rules on it, so the number visibly drops while the result screen
 * is still open. `router.refresh()` then re-reads the truth in the background,
 * and the optimistic layer is thrown away when the fresh data lands. On a slow
 * Ghanaian connection the alternative is a screen that appears not to have
 * registered the ad the user just finished.
 */

type Tab = 'video' | 'survey'

/** Outcomes that mean the ad is gone from this user's feed for good. */
const CLOSES_AD = new Set(['correct', 'locked', 'already_completed', 'not_eligible'])

type Optimistic = {
  /** Ads resolved locally that the server has not yet dropped from the feed. */
  completedIds: string[]
  /** Daily allowance used since this data was fetched. */
  spent: number
  /** Points credited since this data was fetched. */
  earned: number
}

const EMPTY_OPTIMISTIC: Optimistic = { completedIds: [], spent: 0, earned: 0 }

export function AdsView({ data }: { data: AdsData }) {
  const t = useTranslations('ads')
  const router = useRouter()

  /* Optimistic layer over the server data, thrown away the moment fresh data
     arrives — a new server render already excludes what was completed, so
     keeping the local adjustments on top of it would double-count.
     Adjusting state during render (rather than in an effect) is React's own
     answer to "reset when a prop changes": it happens before anything paints,
     so the stale numbers are never shown. */
  const [optimistic, setOptimistic] = useState(EMPTY_OPTIMISTIC)
  const [snapshot, setSnapshot] = useState(data)
  if (snapshot !== data) {
    setSnapshot(data)
    setOptimistic(EMPTY_OPTIMISTIC)
  }
  const { completedIds, spent, earned } = snapshot === data ? optimistic : EMPTY_OPTIMISTIC

  const videos = data.videos.filter((a) => !completedIds.includes(a.id))
  const surveys = data.surveys.filter((a) => !completedIds.includes(a.id))

  const remainingToday = Math.max(data.status.remainingToday - spent, 0)
  const completedToday = data.status.completedToday + spent
  const balance = data.status.balance + earned

  const videoCount = Math.min(videos.length, remainingToday)
  const surveyCount = Math.min(surveys.length, remainingToday)

  // Open on whichever side has something to do, so a user with no videos left
  // does not land on an empty tab and assume the product is broken.
  const [tab, setTab] = useState<Tab>(() => (videoCount === 0 && surveyCount > 0 ? 'survey' : 'video'))
  const [playing, setPlaying] = useState<FeedAd | null>(null)

  const list = tab === 'video' ? videos : surveys
  const count = tab === 'video' ? videoCount : surveyCount
  const otherCount = tab === 'video' ? surveyCount : videoCount

  function handleResolved(adId: string, result: SubmitAdResult) {
    setOptimistic((o) => ({
      completedIds: CLOSES_AD.has(result.outcome) ? [...o.completedIds, adId] : o.completedIds,
      // The cap outcome is the server telling us the allowance is gone,
      // whatever we thought it was.
      spent:
        result.outcome === 'daily_cap_reached'
          ? data.status.remainingToday
          : result.outcome === 'correct'
            ? o.spent + 1
            : o.spent,
      earned: result.outcome === 'correct' ? o.earned + result.pointsAwarded : o.earned,
    }))
    router.refresh()
  }

  // ---- Blocking states ---------------------------------------------------
  // Both are decided by the database on every submission anyway; showing them
  // up front stops a user watching a whole ad only to be told it paid nothing.
  if (data.status.accountDisabled || data.status.earningPaused) {
    const disabled = data.status.accountDisabled
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            className={cn(
              'grid size-14 place-items-center rounded-full ring-8',
              disabled
                ? 'bg-danger-50 text-danger-600 ring-danger-500/15'
                : 'bg-warning-50 text-warning-600 ring-warning-500/15',
            )}
          >
            {disabled ? (
              <AlertTriangle aria-hidden className="size-6" />
            ) : (
              <PauseCircle aria-hidden className="size-6" />
            )}
          </span>
          <h1 className="text-[1.125rem] font-semibold text-ink-900">
            {t(disabled ? 'blocked.disabledTitle' : 'blocked.pausedTitle')}
          </h1>
          <p className="max-w-[38ch] text-[0.875rem] leading-relaxed text-ink-500">
            {t(disabled ? 'blocked.disabledBody' : 'blocked.pausedBody')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 pb-8 sm:px-6 lg:px-8">
      {/* ---- Allowance meter --------------------------------------------- */}
      <section
        className="animate-rise rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 sm:px-5"
        style={{ '--rise-delay': '0s' } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
              {t('allowance.label')}
            </p>
            <p className="mt-1 text-[1.375rem] leading-none font-bold text-ink-900 tabular-nums">
              {completedToday}
              <span className="text-[0.9375rem] font-semibold text-ink-400">
                {' '}
                / {data.status.dailyAdCap}
              </span>
            </p>
          </div>

          <div className="text-right">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
              {t('allowance.balance')}
            </p>
            <p className="mt-1 text-[0.9375rem] leading-none font-semibold text-ink-900 tabular-nums">
              {balance.toLocaleString()}{' '}
              <span className="text-[0.75rem] font-medium text-ink-400">
                {t('allowance.points')}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <span
            className="block h-full rounded-full bg-brand-600 transition-[width] duration-500"
            style={{
              width: `${
                data.status.dailyAdCap > 0
                  ? Math.min((completedToday / data.status.dailyAdCap) * 100, 100)
                  : 0
              }%`,
            }}
          />
        </div>

        <p className="mt-2 text-[0.75rem] text-ink-500">
          {remainingToday > 0
            ? t('allowance.remaining', { count: remainingToday, tier: data.status.tierName })
            : t('allowance.spent', { tier: data.status.tierName })}
        </p>
      </section>

      {/* ---- Format switch -----------------------------------------------
          Same segmented control as the notifications tabs — one switching
          idiom across the app — but sized as a primary control, with the
          count riding in the segment because that is the thing the operator
          wants read at a glance. */}
      <div
        role="tablist"
        aria-label={t('tabs.label')}
        className="animate-rise mt-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1"
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
      >
        {(['video', 'survey'] as const).map((key) => {
          const selected = key === tab
          const badge = key === 'video' ? videoCount : surveyCount
          const Icon = key === 'video' ? PlayCircle : ListChecks
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius-input)-0.25rem)]',
                'px-3 py-2.5 text-[0.875rem] font-semibold transition-colors',
                selected
                  ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                  : 'text-ink-500 hover:text-ink-700',
              )}
            >
              <Icon
                aria-hidden
                className={cn('size-4', selected ? 'text-brand-600' : 'text-ink-400')}
              />
              {t(`tabs.${key}`)}
              <span
                className={cn(
                  'min-w-6 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold tabular-nums',
                  selected
                    ? badge > 0
                      ? 'bg-brand-600 text-white'
                      : 'bg-ink-200 text-ink-500'
                    : 'bg-ink-200 text-ink-500',
                )}
              >
                {badge}
              </span>
            </button>
          )
        })}
      </div>

      {/* ---- Feed --------------------------------------------------------- */}
      <div role="tabpanel" className="mt-4">
        {count === 0 ? (
          <CaughtUp
            variant={remainingToday === 0 ? 'capped' : 'empty'}
            format={tab}
            resetAt={data.resetAt}
            dailyCap={data.status.dailyAdCap}
            tierName={data.status.tierName}
            otherCount={otherCount}
            onSwitch={() => setTab(tab === 'video' ? 'survey' : 'video')}
          />
        ) : (
          <ul
            className={cn(
              'grid gap-3 sm:gap-4',
              'sm:grid-cols-2 xl:grid-cols-3',
              // The first card runs wide on the widest breakpoint. A perfectly
              // uniform grid is the generic answer; a lead card is what makes
              // a feed read as curated rather than as a table of results.
              // It spans two ROWS as well as two columns, so the third column
              // stacks two ordinary cards beside it and the grid has no hole —
              // spanning columns alone leaves the tall row half empty.
              '[&>li:first-child]:xl:col-span-2 [&>li:first-child]:xl:row-span-2',
            )}
          >
            {/* Only the ads the allowance actually covers are offered. Showing
                a card that would be refused on submit is a broken promise. */}
            {list.slice(0, count).map((ad, i) => (
              <li key={ad.id}>
                <AdCard
                  ad={ad}
                  onOpen={setPlaying}
                  featured={i === 0}
                  style={{ '--rise-delay': `${Math.min(i, 6) * 0.04 + 0.1}s` } as React.CSSProperties}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {playing && (
        <AdPlayer
          // Keyed by ad so opening a second ad gets a genuinely fresh player
          // rather than a reused one holding the previous ad's questions.
          key={playing.id}
          ad={playing}
          onClose={() => setPlaying(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  )
}
