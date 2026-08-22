'use client'

import {
  ArrowUpRight,
  AtSign,
  Briefcase,
  Camera,
  Globe,
  Mail,
  MessageCircle,
  Music2,
  Phone,
  PlaySquare,
  Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { ctaDisplay, usableCtaLinks, type CtaKind, type CtaLink } from '@/lib/ads/cta'
import { cn } from '@/lib/cn'

/**
 * What the advertiser wants the viewer to do next.
 *
 * Shown on video ads. A survey deliberately carries none, so nothing here is
 * reachable from one; a link ad has exactly one destination and draws it as
 * the single paying button in LinkAdReader rather than through this.
 *
 * TWO PLACES, TWO SKINS. Under the video it sits on black, so it is drawn in
 * white-on-transparent; on the result card it sits on the surface, so it uses
 * the ordinary tokens. Same component, because the advertiser's links must not
 * be two different sets of links depending on where you look.
 *
 * Every link opens in a new tab with `rel="noopener noreferrer"`: the ad is
 * still running underneath, and a viewer who taps a website must come back to
 * a player that is exactly where they left it — not to a page that navigated
 * away mid-attempt and lost their watch time.
 *
 * `nofollow` because these are paid placements, and passing search authority
 * to whoever bought an ad slot is not something to do by accident.
 */

const ICON: Record<CtaKind, typeof Globe> = {
  website: Globe,
  whatsapp: MessageCircle,
  phone: Phone,
  email: Mail,
  // lucide-react dropped its brand marks (a trademark question, not an
  // oversight), so each social channel gets a plain icon that says what it
  // is for. The channel's NAME is always beside it, so nothing depends on
  // recognising the glyph.
  instagram: Camera,
  facebook: Users,
  x: AtSign,
  tiktok: Music2,
  youtube: PlaySquare,
  linkedin: Briefcase,
}

export function AdCta({
  label,
  links,
  tone,
  className,
}: {
  /** The advertiser's own button text. Falls back to a per-channel default. */
  label: string | null
  links: CtaLink[]
  tone: 'onVideo' | 'onSurface'
  className?: string
}) {
  const t = useTranslations('ads.cta')
  const usable = usableCtaLinks(links)
  if (usable.length === 0) return null

  const [primary, ...rest] = usable
  const PrimaryIcon = ICON[primary.link.kind] ?? Globe
  const onVideo = tone === 'onVideo'

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p
        className={cn(
          'text-[0.75rem] font-semibold tracking-[0.05em] uppercase',
          onVideo ? 'text-white/80' : 'text-ink-500',
        )}
      >
        {t('heading')}
      </p>

      <div
        className={cn(
          'flex flex-wrap items-center gap-2',
          // On the result card everything is centred, so the links are too —
          // a left-aligned row under a centred heading reads as misplaced.
          !onVideo && 'justify-center',
        )}
      >
        <a
          href={primary.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={cn(
            'inline-flex h-10 min-w-0 items-center gap-2 rounded-(--radius-input) px-3.5',
            'text-[0.8125rem] font-bold transition-colors',
            onVideo
              ? 'bg-white text-slate-950 shadow-md ring-1 ring-white/40 hover:bg-slate-100'
              : 'border border-brand-600/30 bg-brand-50 text-brand-700 hover:border-brand-600/50 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300',
          )}
        >
          <PrimaryIcon aria-hidden className="size-4 shrink-0 text-inherit" />
          <span className="truncate">
            {label?.trim() || t(`default.${primary.link.kind}`)}
          </span>
          <ArrowUpRight aria-hidden className="size-3.5 shrink-0 opacity-80" />
        </a>

        {rest.map((entry, i) => {
          const Icon = ICON[entry.link.kind] ?? Globe
          return (
            <a
              key={`${entry.link.kind}-${i}`}
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`${t(`default.${entry.link.kind}`)} — ${ctaDisplay(entry.link)}`}
              title={ctaDisplay(entry.link)}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-(--radius-input) px-3',
                'text-[0.75rem] font-medium transition-colors',
                onVideo
                  ? 'bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm hover:bg-white/25'
                  : 'border border-ink-200 bg-surface text-ink-700 hover:border-ink-300 hover:text-ink-900',
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="hidden max-w-[10rem] truncate sm:inline">
                {ctaDisplay(entry.link)}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
