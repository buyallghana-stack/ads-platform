'use client'

import { useEffect, useState } from 'react'

import { CheckCheck, Gem, ListChecks, PlayCircle, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * The "you're all caught up" screen, with the countdown the operator asked
 * for. There are two genuinely different reasons a tab can be empty and they
 * need different countdowns, because a countdown that is not counting down to
 * anything real is worse than none:
 *
 *   capped  The daily allowance is spent. The counters roll over at UTC
 *           midnight, so this really is a clock, and the honest extra offer is
 *           a higher limit — which is what the plans sell.
 *
 *   empty   There is allowance left but no ad of this format waiting. Nobody
 *           can say when the next campaign lands, so inventing a time would be
 *           a lie. Instead the screen re-checks the server on a short loop and
 *           counts down to that check — a countdown to the next ads that is
 *           literally true, and which makes a new campaign appear without the
 *           user having to think about refreshing.
 */

const RECHECK_SECONDS = 60

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** Live HH:MM:SS remaining until `target`. */
function useCountdown(target: number) {
  const [remaining, setRemaining] = useState(() => Math.max(target - Date.now(), 0))

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

export function CaughtUp({
  variant,
  format,
  resetAt,
  dailyCap,
  tierName,
  otherCount,
  onSwitch,
}: {
  variant: 'capped' | 'empty'
  format: 'video' | 'survey'
  /** Epoch ms of the next UTC midnight — when the daily allowance refills. */
  resetAt: number
  dailyCap: number
  tierName: string
  /** How many ads wait on the other tab, so the offer to switch is only made
   *  when there is something to switch to. */
  otherCount: number
  onSwitch: () => void
}) {
  const t = useTranslations('ads')
  const router = useRouter()
  const { text } = useCountdown(resetAt)

  // The re-check loop, for the "no ads of this format" case.
  const [tick, setTick] = useState(RECHECK_SECONDS)
  useEffect(() => {
    if (variant !== 'empty') return
    const id = setInterval(() => {
      setTick((s) => {
        if (s > 1) return s - 1
        router.refresh()
        return RECHECK_SECONDS
      })
    }, 1000)
    return () => clearInterval(id)
  }, [variant, router])

  const capped = variant === 'capped'

  return (
    <div className="animate-rise flex flex-col items-center px-5 py-12 text-center sm:py-16">
      <span
        className={cn(
          'grid size-16 place-items-center rounded-full ring-8',
          capped ? 'bg-brand-50 text-brand-600 ring-brand-600/15' : 'bg-success-50 text-success-600 ring-success-500/15',
        )}
      >
        <CheckCheck aria-hidden className="size-7" strokeWidth={2.4} />
      </span>

      <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">
        {t('caughtUp.title')}
      </h2>
      <p className="mt-1.5 max-w-[36ch] text-[0.875rem] leading-relaxed text-ink-500">
        {capped
          ? t('caughtUp.cappedBody', { cap: dailyCap, tier: tierName })
          : t(format === 'video' ? 'caughtUp.emptyVideoBody' : 'caughtUp.emptySurveyBody')}
      </p>

      {/* ---- Countdown --------------------------------------------------- */}
      <div className="mt-7 w-full max-w-[22rem] rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-5">
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
          {capped ? t('caughtUp.resetLabel') : t('caughtUp.recheckLabel')}
        </p>
        <div className="mt-2">
          {/* HH:MM:SS for the wait until midnight, bare seconds for the
              re-check. "00:00:58" spends most of its width on zeros and makes
              a one-minute loop look like a long one. */}
          <Digits value={capped ? text : `${tick}s`} />
        </div>
        <p className="mt-2 text-[0.75rem] text-ink-400">
          {capped ? t('caughtUp.resetHint') : t('caughtUp.recheckHint')}
        </p>
      </div>

      {/* ---- What to do meanwhile ----------------------------------------
          Ordered by what actually helps: the other tab first when it has ads
          (free, immediate), then a manual re-check, and only then the paid
          option. Leading with "upgrade" on a screen that says "come back
          later" reads as a shakedown. */}
      <div className="mt-6 flex w-full max-w-[22rem] flex-col gap-2">
        {otherCount > 0 && (
          <Button
            fullWidth
            onClick={onSwitch}
            leadingIcon={format === 'video' ? <ListChecks /> : <PlayCircle />}
          >
            {t(format === 'video' ? 'caughtUp.switchToSurveys' : 'caughtUp.switchToVideos', {
              count: otherCount,
            })}
          </Button>
        )}

        {!capped && (
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
