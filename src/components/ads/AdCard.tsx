'use client'

import { BookOpen, HelpCircle, ListChecks, Play, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { FeedAd } from '@/lib/ads/data'
import { cn } from '@/lib/cn'

import { AdCover } from './AdCover'
import { AdvertiserMark } from './AdvertiserMark'

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
 * Surveys and link ads reuse the same card with a different lead icon, and a
 * question count or a reading time where a duration would be. None of them is
 * given its own colour: the platform's accent hues carry fixed meanings
 * (violet = plans, orange = referrals) and inventing one per format would
 * erode that. Format is signalled by icon and by what the metadata says, which
 * is enough.
 */

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
  const isLink = ad.format === 'link'
  const duration = formatDuration(ad.durationSeconds)
  const retried = ad.attemptsUsed > 0

  return (
    <button
      type="button"
      onClick={() => onOpen(ad)}
      style={style}
      /* A handle for `verify-legacy-css.mjs`, which checks this card still has
         a painted border on a browser with no `@property` support. The card is
         a <button> rather than an <article>, so there is no element role to
         select it by. */
      data-ad-card=""
      /*
        ⚠️ NO LAYOUT ON THE BUTTON ITSELF, AND THAT IS THE IPHONE 7 FIX.

        WebKit did not support flexbox or grid layout ON A BUTTON ELEMENT until
        Safari 16. Before that the button's children are laid out in an
        anonymous block box and `display: flex` is ignored, so `flex-col` did
        nothing and the cover's percentage-padding spacer had no containing
        block to size against. It collapsed, and the play disc centred on a
        collapsed box landed on the title (operator, 2026-08-11 and again
        2026-08-12 after two fixes aimed at the cover).

        Proved on the phone rather than reasoned about: a throwaway probe page
        rendered this exact markup on the operator's iPhone 7 and reported a
        192px cover, `flex / column` and a solid border when the root was a
        <div>. The only difference left was this element. The probe was deleted
        once the fix was confirmed (2026-08-12) — it was scaffolding.

        So the button keeps the frame — border, radius, shadow, focus ring —
        and every bit of LAYOUT moves to the span inside it. Buttons are the
        one element where that separation is not optional.
      */
      className={cn(
        'group animate-rise relative block h-full w-full overflow-hidden text-left',
        'rounded-(--radius-card) border border-ink-200 bg-surface',
        'shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-ink-300 hover:shadow-[0_2px_10px_-2px_rgb(15_23_42/0.12)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
      )}
    >
      <span className="flex h-full w-full flex-col">
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
            /* ⚠️ NO `aspect-video` HERE, AND THAT IS THE FIX. The 16:9 comes
               from the padding spacer inside the cover and from nothing else.

               The first attempt kept `aspect-ratio` and added the spacer as a
               fallback, on the theory that Safari 15 ignores the property. It
               did not fix the operator's phone. Safari does not ignore it on a
               flex item, it resolves it to a definite height of ZERO, and a
               definite zero plus `overflow-hidden` clips the spacer instead of
               letting it grow the box. A fallback cannot help while the broken
               value is still winning.

               Percentage padding has meant "of the container's width" since
               CSS 2.1, so this needs no feature from any browser. */
            className={cn('w-full', featured && 'min-h-0 flex-1')}
            /* The featured card drops the spacer at xl, which is the one place
               the cover is meant to STRETCH to fill the two rows it spans
               rather than keep 16:9. That is what `xl:aspect-auto` used to do. */
            spacerClassName={featured ? 'xl:hidden' : undefined}
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
              ) : isLink ? (
                <BookOpen className="size-6" strokeWidth={2.2} />
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
            {/* A link ad asks for a read and one tap, and says so — being told
                afterwards that you were expected to leave the app is the kind
                of surprise that makes somebody distrust the whole feed. */}
            {isLink ? (
              t('card.readAndTap')
            ) : ad.questionCount === 0 ? (
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
              {/* A link ad's reading time is a real number the user is held to,
                  so it goes where a video puts its length. */}
              {isLink
                ? t('card.readSeconds', { seconds: ad.minWatchSeconds ?? 10 })
                : (duration ?? t('card.quick'))}
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
          <AdvertiserMark name={ad.advertiser} logoUrl={ad.advertiserLogoUrl} />

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
      </span>
    </button>
  )
}
