'use client'

import { useEffect, useState } from 'react'

import { CheckCheck, Gem, Link2, ListChecks, PlayCircle, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * The "you're all caught up" screen, with the countdown the operator asked
 * for. Four genuinely different reasons a tab can stop, each needing its own
 * countdown — a countdown that is not counting down to anything real is worse
 * than none:
 *
 *   capped      The daily ad allowance is spent. The counters roll over at UTC
 *               midnight, so this really is a clock, and the honest extra
 *               offer is a higher limit — which is what the plans sell.
 *
 *   pointsCapped
 *               They still have ads left but have hit per_user_daily_points_cap,
 *               so watching more would pay nothing. Same midnight clock, but
 *               NO upgrade offer: a bigger plan does not raise this ceiling,
 *               and selling one here would be a lie.
 *
 *   blocked     The platform kill switch or the reward-pool stop. Nobody can
 *               say when it lifts, so there is no countdown at all — just the
 *               truth and a way to re-check.
 *
 *   empty       There is allowance left but no ad of this format waiting.
 *               Counts down to the same midnight rollover (operator decision
 *               2026-07-25). An earlier version counted down 60 seconds to its
 *               own background re-check, which was literally true and read as
 *               nonsense: "new ads in 58s" promises ads that usually are not
 *               coming. The daily reset is the milestone a user actually plans
 *               around. The re-check still runs, quietly, so a campaign added
 *               mid-day still appears without anyone pressing anything.
 *
 * Ghana keeps GMT all year, so midnight UTC IS local midnight for this
 * audience — the countdown needs no timezone caveat and the copy no longer
 * carries one.
 */

const RECHECK_SECONDS = 60

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * Live HH:MM:SS remaining until `target`.
 *
 * `serverNow` is not a nicety: seeding from Date.now() makes the server and
 * the client compute different first values, React reports a hydration
 * mismatch (#418) and throws the markup away. Seeding from the server's clock
 * makes the first paint identical on both sides; the interval takes over
 * afterwards, when only the client is running.
 */
function useCountdown(target: number, serverNow: number) {
  const [remaining, setRemaining] = useState(() => Math.max(target - serverNow, 0))

  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(target - Date.now(), 0)), 1000)
    return () => clearInterval(id)
  }, [target])

  const totalSeconds = Math.floor(remaining / 1000)
  return {
    remaining,
    text: `${pad(Math.floor(totalSeconds / 3600))}:${pad(
      Math.floor((totalSeconds % 3600) / 60),
    )}:${pad(totalSeconds % 60)}`,
  }
}

function Digits({ value }: { value: string }) {
  return (
    <p
      className={cn(
        'font-bold text-ink-900 tabular-nums',
        // Big enough to read across a room, which is roughly how a phone is
        // held when someone is waiting for a countdown to finish.
        'text-[2rem] leading-none tracking-[-0.02em] sm:text-[2.5rem]',
      )}
    >
      {value}
    </p>
  )
}

export type CaughtUpVariant = 'capped' | 'pointsCapped' | 'blocked' | 'empty'

/** One of the other tabs, and how many ads are waiting on it. */
export type OtherTab = { key: 'video' | 'survey' | 'link'; count: number }

const SWITCH_ICON = {
  video: PlayCircle,
  survey: ListChecks,
  link: Link2,
} as const

export function CaughtUp({
  variant,
  format,
  resetAt,
  serverNow,
  dailyCap,
  tierName,
  others,
  onSwitch,
}: {
  variant: CaughtUpVariant
  format: 'video' | 'survey' | 'link'
  /** Epoch ms of the next midnight — when the daily allowance refills. */
  resetAt: number
  /** Server clock at render time; keeps the first countdown frame in step. */
  serverNow: number
  dailyCap: number
  tierName: string
  /** The other tabs that have ads waiting. Empty means no offer to switch —
   *  a button leading to another empty tab is worse than no button. */
  others: OtherTab[]
  onSwitch: (key: OtherTab['key']) => void
}) {
  const t = useTranslations('ads')
  const router = useRouter()
  const { text } = useCountdown(resetAt, serverNow)

  /* Background re-check for the "out of ads" case. Deliberately invisible:
     it exists so a campaign published mid-day appears on its own, not as
     something for the user to watch. */
  useEffect(() => {
    if (variant !== 'empty') return
    const id = setInterval(() => router.refresh(), RECHECK_SECONDS * 1000)
    return () => clearInterval(id)
  }, [variant, router])

  const capped = variant === 'capped'
  const pointsCapped = variant === 'pointsCapped'
  const blocked = variant === 'blocked'
  const empty = variant === 'empty'

  return (
    <div className="animate-rise flex flex-col items-center px-5 py-12 text-center sm:py-16">
      <span
        className={cn(
          'grid size-16 place-items-center rounded-full ring-8',
          blocked
            ? 'bg-warning-50 text-warning-600 ring-warning-500/15'
            : empty
              ? 'bg-success-50 text-success-600 ring-success-500/15'
              : 'bg-brand-50 text-brand-600 ring-brand-600/15',
        )}
      >
        <CheckCheck aria-hidden className="size-7" strokeWidth={2.4} />
      </span>

      <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">
        {t(blocked ? 'caughtUp.blockedTitle' : 'caughtUp.title')}
      </h2>
      <p className="mt-1.5 max-w-[36ch] text-[0.875rem] leading-relaxed text-ink-500">
        {capped
          ? t('caughtUp.cappedBody', { cap: dailyCap, tier: tierName })
          : pointsCapped
            ? t('caughtUp.pointsCappedBody')
            : blocked
              ? t('caughtUp.blockedBody')
              : t(`caughtUp.empty.${format}`)}
      </p>

      {/* ---- Countdown ---------------------------------------------------
          Omitted entirely when blocked: nobody knows when a kill switch or a
          reward-pool stop lifts, and a made-up timer would be the one thing
          worse than no timer. */}
      {!blocked && (
        <div className="mt-7 w-full max-w-[22rem] rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
            {t('caughtUp.resetLabel')}
          </p>
          <div className="mt-2">
            <Digits value={text} />
          </div>
          <p className="mt-2 text-[0.75rem] text-ink-400">
            {t(empty ? 'caughtUp.newAdsHint' : 'caughtUp.resetHint')}
          </p>
        </div>
      )}

      {/* ---- What to do meanwhile ----------------------------------------
          Ordered by what actually helps: the other tab first when it has ads
          (free, immediate), then a manual re-check, and only then the paid
          option. Leading with "upgrade" on a screen that says "come back
          later" reads as a shakedown. */}
      <div className="mt-6 flex w-full max-w-[22rem] flex-col gap-2">
        {!pointsCapped &&
          !blocked &&
          others.map(({ key, count }, i) => {
            const Icon = SWITCH_ICON[key]
            return (
              <Button
                key={key}
                fullWidth
                /* Only the first offer is the loud one. Two primary buttons
                   stacked read as a choice between equals, when what is meant
                   is "here is something to do, and here is another". */
                variant={i === 0 ? 'primary' : 'secondary'}
                onClick={() => onSwitch(key)}
                leadingIcon={<Icon />}
              >
                {t(`caughtUp.switchTo.${key}`, { count })}
              </Button>
            )
          })}

        {(empty || blocked) && (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => router.refresh()}
            leadingIcon={<RefreshCw />}
          >
            {t('caughtUp.checkNow')}
          </Button>
        )}

        {capped && (
          <Link
            href="/upgrade"
            className={cn(
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-input)',
              'border border-violet-600/25 bg-violet-50 text-[0.875rem] font-semibold text-violet-700',
              'transition-colors hover:border-violet-600/45',
            )}
          >
            <Gem aria-hidden className="size-4" />
            {t('caughtUp.raiseLimit')}
          </Link>
        )}
      </div>
    </div>
  )
}
