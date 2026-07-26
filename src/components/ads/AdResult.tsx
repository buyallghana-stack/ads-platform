'use client'

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Coins,
  Gem,
  Hourglass,
  Lock,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { SubmitAdResult } from '@/app/[locale]/(app)/ads/actions'
import { Button } from '@/components/ui/Button'
import { Link } from '@/i18n/navigation'
import type { FeedAd } from '@/lib/ads/data'
import { cn } from '@/lib/cn'

import { AdCta } from './AdCta'

/**
 * What happened after a submission.
 *
 * The database returns nine distinct outcomes and they are NOT all failures of
 * the same kind — some cost the user an attempt, some deliberately cost them
 * nothing (a daily cap, the kill switch, an ad selling out mid-watch). The
 * copy is written per outcome so a user is never told "incorrect" when the
 * truth is "the advertiser's budget ran out while you were watching", which
 * would be both wrong and infuriating.
 *
 * `message` from the database is a developer sentence, never shown. It is kept
 * on the result only for the one case with no translated copy.
 */

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand'

const TONE_RING: Record<Tone, string> = {
  success: 'bg-success-50 text-success-600 ring-success-500/20',
  warning: 'bg-warning-50 text-warning-600 ring-warning-500/20',
  danger: 'bg-danger-50 text-danger-600 ring-danger-500/20',
  neutral: 'bg-ink-100 text-ink-500 ring-ink-200',
  brand: 'bg-brand-50 text-brand-600 ring-brand-600/20',
}

type Shape = {
  tone: Tone
  Icon: typeof Check
  key: string
  /** Offer a re-watch: the answer was wrong and attempts remain. */
  retry?: boolean
  /** Offer the upgrade path: they ran out of daily allowance, not of ads. */
  upgrade?: boolean
}

const SHAPES: Record<string, Shape> = {
  correct: { tone: 'success', Icon: Check, key: 'correct' },
  incorrect: { tone: 'warning', Icon: RotateCcw, key: 'incorrect', retry: true },
  locked: { tone: 'neutral', Icon: Lock, key: 'locked' },
  already_completed: { tone: 'neutral', Icon: Check, key: 'alreadyDone' },
  not_eligible: { tone: 'neutral', Icon: X, key: 'gone' },
  not_watched: { tone: 'warning', Icon: RotateCcw, key: 'notWatched', retry: true },
  too_fast: { tone: 'warning', Icon: Clock, key: 'tooFast', retry: true },
  daily_cap_reached: { tone: 'brand', Icon: Gem, key: 'cap', upgrade: true },
  // A cooldown is a wait of seconds, not a day. Reporting it as the daily cap
  // told people to come back tomorrow when they needed to count to thirty.
  cooldown_active: { tone: 'neutral', Icon: Hourglass, key: 'cooldown' },
  // The count cap and the points ceiling are different limits and stacking
  // makes them diverge, so they get different sentences.
  points_cap_reached: { tone: 'brand', Icon: Coins, key: 'pointsCap' },
  earning_blocked: { tone: 'warning', Icon: AlertTriangle, key: 'blocked' },
  error: { tone: 'danger', Icon: AlertTriangle, key: 'error', retry: true },
}

export function AdResult({
  result,
  format,
  ad,
  onNext,
  onRetry,
  onKeepWatching,
  onNextAd,
}: {
  result: SubmitAdResult
  /** A survey has nothing to re-watch, so "Watch again" is the wrong word for
   *  half of these screens. The copy branches on format rather than pretending
   *  every ad is a video. */
  format: 'video' | 'survey'
  /** Close and move on to the rest of the feed. */
  onNext: () => void
  /** The ad just watched, for the advertiser's links. */
  ad: FeedAd
  /** Restart this ad from the top — a wrong answer clears the server-side
   *  watch stamp, so the video genuinely has to be watched again. */
  onRetry: () => void
  /**
   * Dismiss this card and go back to the film.
   *
   * Undefined when there is nothing left to watch, or when the attempt was
   * not credited. Being paid should not eject somebody from an ad they were
   * enjoying — and an advertiser is not helped by their film being cut off at
   * the moment it has the viewer's attention.
   */
  onKeepWatching?: () => void
  /** Straight into the next ad, without a return trip through the feed. */
  onNextAd?: () => void
}) {
  const t = useTranslations('ads')
  const shape = SHAPES[result.outcome] ?? SHAPES.error
  const { Icon } = shape
  const isSurvey = format === 'survey'

  /* Only the two retry-flavoured outcomes read differently for a survey;
     everything else ("daily limit", "no tries left") is format-neutral. */
  const bodyKey =
    isSurvey && (shape.key === 'incorrect' || shape.key === 'notWatched')
      ? `${shape.key}Survey`
      : shape.key

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
      <span
        className={cn(
          'grid size-16 place-items-center rounded-full ring-8',
          TONE_RING[shape.tone],
        )}
      >
        <Icon aria-hidden className="size-7" strokeWidth={2.4} />
      </span>

      <div className="space-y-1.5">
        <h2 className="text-[1.125rem] font-semibold text-ink-900">
          {t(`result.${shape.key}.title`)}
        </h2>
        <p className="max-w-[34ch] text-[0.875rem] leading-relaxed text-ink-500">
          {t(`result.${bodyKey}.body`, { count: result.attemptsRemaining })}
        </p>
      </div>

      {result.outcome === 'correct' && (
        <div className="w-full max-w-[18rem] rounded-(--radius-card) border border-success-500/20 bg-success-50 px-4 py-3">
          <p className="text-[1.75rem] leading-none font-bold text-success-700 tabular-nums">
            +{result.pointsAwarded}
          </p>
          <p className="mt-1 text-[0.75rem] font-medium text-success-700/80">
            {t('result.pointsAdded')}
          </p>
          {result.newBalance !== null && (
            <p className="mt-2 border-t border-success-500/20 pt-2 text-[0.75rem] text-ink-500">
              {t('result.newBalance', { balance: result.newBalance })}
            </p>
          )}
        </div>
      )}

      {/* The advertiser's links, at the moment of highest attention: the
          viewer has just been paid and is looking at the card. Video only —
          a survey carries no call to action at all. */}
      {result.outcome === 'correct' && ad.format === 'video' && (
        <AdCta
          label={ad.ctaLabel}
          links={ad.ctaLinks}
          tone="onSurface"
          className="w-full max-w-[20rem] items-center text-center"
        />
      )}

      <div className="flex w-full max-w-[18rem] flex-col gap-2 pt-1">
        {onKeepWatching && (
          <Button variant="secondary" fullWidth onClick={onKeepWatching} leadingIcon={<Play />}>
            {t('result.keepWatching')}
          </Button>
        )}

        {onNextAd && (
          <Button
            variant={onKeepWatching ? 'primary' : 'secondary'}
            fullWidth
            onClick={onNextAd}
            trailingIcon={<ArrowRight />}
          >
            {t('result.nextAd')}
          </Button>
        )}

        {shape.retry && result.attemptsRemaining > 0 && (
          <Button fullWidth onClick={onRetry} leadingIcon={<RotateCcw />}>
            {isSurvey ? t('result.tryAgain') : t('result.watchAgain')}
          </Button>
        )}

        {shape.upgrade && (
          <Link
            href="/upgrade"
            className={cn(
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-input)',
              'border border-violet-600/25 bg-violet-50 text-[0.875rem] font-semibold text-violet-700',
              'transition-colors hover:border-violet-600/45',
            )}
          >
            <Gem aria-hidden className="size-4" />
            {t('result.raiseLimit')}
          </Link>
        )}

        <Button
          variant={
            (shape.retry && result.attemptsRemaining > 0) || onKeepWatching || onNextAd
              ? 'secondary'
              : 'primary'
          }
          fullWidth
          onClick={onNext}
        >
          {result.outcome === 'correct'
            ? onKeepWatching || onNextAd
              ? t('result.backToAds')
              : t('result.next')
            : t('result.done')}
        </Button>
      </div>
    </div>
  )
}
