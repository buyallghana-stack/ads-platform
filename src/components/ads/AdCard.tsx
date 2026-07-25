'use client'

import { HelpCircle, ListChecks, Play, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { FeedAd } from '@/lib/ads/data'
import { cn } from '@/lib/cn'

import { AdCover } from './AdCover'

/**
 * One ad in the feed.
 *
 * The operator asked for the video side to feel like social media, and what
 * actually produces that feeling is not a colour — it is the shape of the
 * information. Every feed the audience already uses puts the media first at
 * full bleed, then a single line underneath with WHO posted it and a
 * lightweight stat. So: cover, then advertiser avatar + name, then title, with
 * the reward as the one piece of chrome that belongs to us rather than to the
 * genre.
 *
 * Surveys reuse the same card with a different lead icon and a question count
 * where a duration would be. They are deliberately NOT given their own colour:
 * the platform's accent hues carry fixed meanings (violet = plans, orange =
 * referrals) and inventing a sixth for "survey" would erode that. Format is
 * signalled by icon and by what the metadata says, which is enough.
 */

/** Advertiser initial in a tinted tile — the "who posted this" affordance. */
function AdvertiserMark({ name }: { name: string | null }) {
  const letter = (name ?? '·').trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-[0.625rem]',
        'bg-gradient-to-br from-brand-600 to-(--color-brand-accent)',
        'text-[0.8125rem] font-bold text-white',
      )}
    >
      {letter}
    </span>
  )
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function AdCard({
  ad,
  onOpen,
  featured = false,
  style,
}: {
  ad: FeedAd
  onOpen: (ad: FeedAd) => void
  /** First card on the widest breakpoint gets a larger cover. */
  featured?: boolean
  style?: React.CSSProperties
}) {
  const t = useTranslations('ads')
  const isVideo = ad.format === 'video'
  const duration = formatDuration(ad.durationSeconds)
  const retried = ad.attemptsUsed > 0

  return (
    <button
      type="button"
      onClick={() => onOpen(ad)}
      style={style}
      className={cn(
        'group animate-rise relative flex h-full w-full flex-col overflow-hidden text-left',
        'rounded-(--radius-card) border border-ink-200 bg-surface',
        'shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-ink-300 hover:shadow-[0_2px_10px_-2px_rgb(15_23_42/0.12)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
      )}
    >
      {/* ---- Cover ------------------------------------------------------
          The featured card fills the two grid rows it spans, so its cover
          grows instead of leaving a hole beside the shorter cards next to it.
          Everywhere else the cover keeps a fixed 16:9. */}
      <div className={cn('relative', featured && 'flex min-h-0 flex-1 flex-col')}>
        <AdCover
          seed={ad.id}
          src={ad.thumbnailUrl}
          title={ad.title}
          format={ad.format}
          className={cn(
            'w-full',
            featured ? 'aspect-video min-h-0 flex-1 xl:aspect-auto' : 'aspect-video',
          )}
        />

        {/* Play affordance. A dark disc rather than a light one: these covers
            are unknown photographs, and half of them are bright — a white
            scrim over a beach dissolves, while a dark disc with a white rim
            reads on anything. Scales on hover the way a tappable video does,
            and stays static for anyone who asked for less motion. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 grid place-items-center',
          )}
        >
          <span
            className={cn(
              'grid place-items-center rounded-full',
              'bg-black/45 text-white backdrop-blur-[2px]',
              'ring-1 ring-white/55 shadow-[0_2px_12px_-2px_rgb(0_0_0/0.5)]',
              'transition-transform duration-200 group-hover:scale-110',
              featured ? 'size-16 xl:size-20' : 'size-14',
            )}
          >
            {isVideo ? (
              <Play className="size-6 translate-x-[1px] fill-current" strokeWidth={0} />
            ) : (
              <ListChecks className="size-6" strokeWidth={2.2} />
            )}
          </span>
        </span>

        {/* Bottom-left: what this ad asks of you. The operator's rule is that
            a question is optional and admin-configured, so a watch-only ad
            says so plainly rather than leaving the user to discover it. */}
        <span
          className={cn(
            'absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full',
            'bg-black/55 px-2 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-[2px]',
          )}
        >
          {ad.questionCount === 0 ? (
            t('card.watchOnly')
          ) : (
            <>
              <HelpCircle aria-hidden className="size-3" />
              {t('card.questions', { count: ad.questionCount })}
            </>
          )}
        </span>

        {/* Bottom-right: duration for a video, question count for a survey —
            the same slot the genre uses for "how long is this". */}
        {(duration || !isVideo) && (
          <span
            className={cn(
              'absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-1',
              'text-[0.6875rem] font-semibold text-white tabular-nums backdrop-blur-[2px]',
            )}
          >
            {duration ?? t('card.quick')}
          </span>
        )}

        {/* A part-finished ad is worth flagging: it costs an attempt to get
            wrong, and the user should know they are mid-way, not starting. */}
        {retried && (
          <span
            className={cn(
              'absolute top-2 left-2 inline-flex items-center gap-1 rounded-full',
              'bg-warning-500 px-2 py-1 text-[0.6875rem] font-semibold text-white',
            )}
          >
            <RotateCcw aria-hidden className="size-3" />
            {t('card.triesLeft', { count: ad.attemptsRemaining })}
          </span>
        )}
      </div>

      {/* ---- Meta row --------------------------------------------------- */}
      <div className="flex shrink-0 items-start gap-2.5 px-3 py-3">
        <AdvertiserMark name={ad.advertiser} />

        <div className="min-w-0 flex-1">
          {/* Two lines, not one: a real advertiser's headline rarely fits in a
              card width, and "market delivery in an…" tells the user less
              about the ad than the second line would. */}
          <p className="line-clamp-2 text-[0.875rem] leading-snug font-semibold text-ink-900">
            {ad.title}
          </p>
          <p className="mt-0.5 truncate text-[0.75rem] text-ink-500">
            {ad.advertiser ?? t('card.sponsored')}
          </p>
        </div>

        {/* Success green: this is money coming in, which is what that hue
            means everywhere else on the platform. */}
        <span
          className={cn(
            'shrink-0 rounded-full border border-success-500/25 bg-success-50',
            'px-2 py-1 text-[0.75rem] font-bold text-success-700 tabular-nums',
          )}
        >
          {t('card.reward', { points: ad.points })}
        </span>
      </div>
    </button>
  )
}
