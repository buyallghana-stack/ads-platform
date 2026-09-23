'use client'

import { useState } from 'react'

import { AlertTriangle, Gem, ListChecks, PauseCircle, PlayCircle, Link2, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { SubmitAdResult } from '@/app/[locale]/(app)/ads/actions'
import type { AdsData, FeedAd } from '@/lib/ads/data'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

import { AdCard } from './AdCard'
import { AdPlayer } from './AdPlayer'
import { LinkAdReader } from './LinkAdReader'
import { CaughtUp, type CaughtUpVariant } from './CaughtUp'
import { AdDisclosure } from '@/components/ads/AdDisclosure'

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

/* Three since 2026-07-31. Kept as a list rather than a union of hard-coded
   branches, because the previous shape had the two formats spelled out in
   seven places and a third could not be added without touching all of them. */
const TABS = ['video', 'survey', 'link'] as const
type Tab = (typeof TABS)[number]

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

  /*
    Why this is NOT part of the optimistic layer above: that layer is wiped
    every time fresh server data lands, and handleResolved calls
    router.refresh() immediately — so a stop recorded there survived for
    about a second and the feed went straight back to offering ads that
    cannot pay.

    The points ceiling now arrives from the server (get_user_earning_status),
    so it is correct on first paint too — a user who is already capped is told
    before they watch anything. The reward-pool stop has no such signal, so it
    is remembered locally for the rest of the session.
  */
  const [sessionStop, setSessionStop] = useState<null | 'points' | 'blocked'>(null)
  const stopped: null | 'points' | 'blocked' =
    sessionStop ?? (data.status.pointsCapReached ? 'points' : null)

  const unfinished = (list: FeedAd[]) => list.filter((a) => !completedIds.includes(a.id))
  const byTab: Record<Tab, FeedAd[]> = {
    video: unfinished(data.videos),
    survey: unfinished(data.surveys),
    link: unfinished(data.links),
  }

  const remainingToday = Math.max(data.status.remainingToday - spent, 0)
  const completedToday = data.status.completedToday + spent
  const balance = data.status.balance + earned

  /* Zeroed while earning is stopped: the ads still exist, but offering "4"
     on the tab beside a body that says you cannot earn today is the screen
     arguing with itself. */
  /* The badge is min(ads of that format, allowance) because the daily cap is
     SHARED across formats — showing supply alone would promise twelve videos
     to somebody with two ads left. Zeroed while earning is stopped: offering
     "4" beside a body that says you cannot earn today is the screen arguing
     with itself. */
  const countFor = (key: Tab) => (stopped ? 0 : Math.min(byTab[key].length, remainingToday))
  const counts: Record<Tab, number> = {
    video: countFor('video'),
    survey: countFor('survey'),
    link: countFor('link'),
  }

  // Open on whichever tab has something to do, so somebody with no videos left
  // does not land on an empty one and assume the product is broken.
  const [tab, setTab] = useState<Tab>(() => TABS.find((key) => counts[key] > 0) ?? 'video')
  const [playing, setPlaying] = useState<FeedAd | null>(null)

  const list = byTab[tab]
  const count = counts[tab]
  /* The OTHER tabs that have something on them. A list rather than a total
     since there are three: "answer 2 surveys instead" is an offer somebody can
     act on, where "6 ads on other tabs" is a number they then have to go and
     hunt through. */
  const others = TABS.filter((key) => key !== tab && counts[key] > 0).map((key) => ({
    key,
    count: counts[key],
  }))

  const caughtUpVariant: CaughtUpVariant =
    stopped === 'points'
      ? 'pointsCapped'
      : stopped === 'blocked'
        ? 'blocked'
        : remainingToday === 0
          ? 'capped'
          : 'empty'

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
    if (result.outcome === 'points_cap_reached') setSessionStop('points')
    if (result.outcome === 'earning_blocked') setSessionStop('blocked')
    router.refresh()
  }

  // ---- Blocking states ---------------------------------------------------
  // All three are decided by the database on every submission anyway; showing
  // them up front stops a user watching a whole ad only to be told it paid
  // nothing. The free window is last because it is the only one of the three
  // that has something to offer: a plan lifts it immediately.
  if (data.status.accountDisabled || data.status.earningPaused || data.status.freeEarningOver) {
    const kind = data.status.accountDisabled
      ? 'disabled'
      : data.status.earningPaused
        ? 'paused'
        : 'freeOver'

    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            className={cn(
              'grid size-14 place-items-center rounded-full ring-8',
              kind === 'disabled'
                ? 'bg-danger-50 text-danger-600 ring-danger-500/15'
                : kind === 'paused'
                  ? 'bg-warning-50 text-warning-600 ring-warning-500/15'
                  : 'bg-violet-50 text-violet-700 ring-violet-600/15',
            )}
          >
            {kind === 'disabled' ? (
              <AlertTriangle aria-hidden className="size-6" />
            ) : kind === 'paused' ? (
              <PauseCircle aria-hidden className="size-6" />
            ) : (
              <Gem aria-hidden className="size-6" />
            )}
          </span>
          <h1 className="text-[1.125rem] font-semibold text-ink-900">
            {t(`blocked.${kind}Title`)}
          </h1>
          <p className="max-w-[38ch] text-[0.875rem] leading-relaxed text-ink-500">
            {t(`blocked.${kind}Body`)}
          </p>

          {/* The only one of the three with a way out, so it gets a button —
              and the balance stays theirs either way, which is said plainly
              because "you can no longer earn" is easily read as "you have
              lost what you earned". */}
          {kind === 'freeOver' && (
            <>
              <Link
                href="/upgrade"
                className={cn(
                  'inline-flex h-11 items-center justify-center gap-2 rounded-(--radius-input) px-5',
                  'border border-violet-600/25 bg-violet-50 text-[0.875rem] font-semibold text-violet-700',
                  'transition-colors hover:border-violet-600/45',
                )}
              >
                <Gem aria-hidden className="size-4" />
                {t('blocked.freeOverCta')}
              </Link>
              <p className="text-[0.75rem] text-ink-400">{t('blocked.freeOverKeep')}</p>
            </>
          )}
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

        {/* When the allowance is smaller than everything on offer it is the
            binding limit, and the two tab badges can add up to more than the
            user can actually do today. Saying it is shared here is what keeps
            those badges honest — each is correct alone, and together they
            would otherwise over-promise. */}
        <p className="mt-2 text-[0.75rem] text-ink-500">
          {remainingToday === 0
            ? t('allowance.spent', { tier: data.status.tierName })
            : remainingToday < byTab.video.length + byTab.survey.length + byTab.link.length
              ? t('allowance.remainingShared', { count: remainingToday })
              : t('allowance.remaining', { count: remainingToday, tier: data.status.tierName })}
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
        {TABS.map((key) => {
          const selected = key === tab
          const badge = counts[key]
          const Icon = key === 'video' ? PlayCircle : key === 'survey' ? ListChecks : Link2
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={cn(
                /* min-w-0 and the truncate below are what keep THREE tabs
                   inside a 390px phone. Without them the strip is wider than
                   the viewport and the whole page scrolls sideways — which is
                   exactly what happened the first time a third format was
                   added. */
                'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-input)-0.25rem)]',
                'px-2 py-2.5 text-[0.8125rem] font-semibold transition-colors',
                'sm:gap-2 sm:px-3 sm:text-[0.875rem]',
                selected
                  ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                  : 'text-ink-500 hover:text-ink-700',
              )}
            >
              {/* The icon is the first thing to go on the narrowest screens:
                  the label already says which format this is, and the count
                  beside it is the thing being read. */}
              <Icon
                aria-hidden
                className={cn('hidden size-4 shrink-0 sm:block', selected ? 'text-brand-600' : 'text-ink-400')}
              />
              <span className="truncate">{t(`tabs.${key}`)}</span>
              <span
                className={cn(
                  'min-w-5 shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold tabular-nums sm:min-w-6',
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

      {/* You have seen these before, and they pay again.
          Only when the feed is genuinely repeats — which happens once
          somebody has finished everything else — because being served an ad
          you recognise with no explanation reads as a broken app, and the
          honest sentence costs one line. */}
      {data.repeating && count > 0 && (
        <p className="animate-rise mt-3 flex items-start gap-2 rounded-(--radius-card) border border-brand-600/20 bg-brand-50 px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-brand-700">
          <RotateCcw aria-hidden className="mt-px size-3.5 shrink-0" />
          {t('repeating')}
        </p>
      )}

      {/* Required by the operator's lawyer: seen every time somebody arrives
          to watch, not only inside an ad. */}
      <AdDisclosure className="mt-3" />

      {/* ---- Feed --------------------------------------------------------- */}
      <div role="tabpanel" className="mt-3">
        {count === 0 ? (
          <CaughtUp
            variant={caughtUpVariant}
            format={tab}
            resetAt={data.resetAt}
            serverNow={data.now}
            dailyCap={data.status.dailyAdCap}
            tierName={data.status.tierName}
            others={others}
            onSwitch={setTab}
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
              /* The first card carries the walkthrough's anchor: a new member
                 is told to open THIS one, and the spotlight cuts its hole
                 around it. */
              <li key={ad.id} data-tour={i === 0 ? 'ad-card' : undefined}>
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

      {/* Next ad resolution: within current format first, or across other formats if current is finished */}
      {(() => {
        if (!playing) return null

        const playingFormat = playing.format
        const currentFormatList = byTab[playingFormat]
        const currentFormatCount = counts[playingFormat]

        // Next in same format (excluding current playing ad)
        const nextInSameFormat =
          currentFormatList
            .slice(0, currentFormatCount)
            .find((a) => a.id !== playing.id) ?? null

        // Next across other formats if same format has none remaining
        const otherTabsWithAds = TABS.filter(
          (key) => key !== playingFormat && counts[key] > 0,
        )
        const nextCrossFormat =
          otherTabsWithAds.length > 0 ? byTab[otherTabsWithAds[0]][0] ?? null : null
        const nextCrossFormatCount =
          otherTabsWithAds.length > 0 ? counts[otherTabsWithAds[0]] : 0

        const nextAdToOffer = nextInSameFormat ?? nextCrossFormat
        const nextAdCountToOffer = nextInSameFormat
          ? Math.max(0, currentFormatCount - 1)
          : nextCrossFormatCount

        const handleNextAd = (targetAd?: FeedAd) => {
          const next = targetAd ?? nextAdToOffer
          if (next) {
            setTab(next.format)
            setPlaying(next)
          } else {
            handleClosePlayer()
          }
        }

        const handleClosePlayer = () => {
          setPlaying(null)
          // If the currently viewed tab has no ads left, switch to the first tab that has ads remaining
          const currentTabCount = counts[tab]
          if (currentTabCount <= 0) {
            const nextTabWithAds = TABS.find((key) => counts[key] > 0)
            if (nextTabWithAds) {
              setTab(nextTabWithAds)
            }
          }
        }

        if (playing.format === 'link') {
          return (
            <LinkAdReader
              key={playing.id}
              ad={playing}
              nextAd={nextAdToOffer}
              nextAdCount={nextAdCountToOffer}
              onClose={handleClosePlayer}
              onNextAd={handleNextAd}
              onResolved={handleResolved}
            />
          )
        }

        return (
          <AdPlayer
            key={playing.id}
            ad={playing}
            nextAd={nextAdToOffer}
            nextAdCount={nextAdCountToOffer}
            onClose={handleClosePlayer}
            onNextAd={handleNextAd}
            onResolved={handleResolved}
          />
        )
      })()}
    </div>
  )
}
