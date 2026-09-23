import { Camera, ExternalLink, MessageCircle, Send, Users } from 'lucide-react'

import type { Community, CommunityPlatform } from '@/lib/communities/data'
import { cn } from '@/lib/cn'

/**
 * Communities somebody can join, on the Profile tab.
 *
 * ── THE NAME IS ALL THEY SEE ──
 *
 * Operator, 2026-08-12: "users should only see the community name so when they
 * click is a link that will automatically send them where it has to". So the
 * url is never rendered. It is the anchor's href and nothing else, and the row
 * reads as a destination rather than as a URL to be inspected.
 *
 * The platform glyph stays, because it is not text: five identically shaped
 * rows tell nobody whether they are about to open WhatsApp or Telegram, and
 * that is the one thing a person wants to know before tapping.
 *
 * ── A LINK OFF THE PLATFORM IS OPENED CAREFULLY ──
 *
 * `target="_blank"` with `rel="noopener noreferrer"`. Without `noopener` the
 * destination gets a handle on `window.opener` and can navigate this tab
 * somewhere else, which on a product that holds somebody's balance is a
 * phishing route we would have built ourselves. The database only accepts
 * `https://` urls, so there is no scheme here to abuse either.
 */

const ICON: Record<CommunityPlatform, typeof Users> = {
  whatsapp: MessageCircle,
  telegram: Send,
  /* Lucide has no X mark and the brand glyph is not ours to ship. A neutral
     speech icon is honest; the name carries the platform, which is how the
     operator asked for it. */
  x: MessageCircle,
  instagram: Camera,
  facebook: Users,
  tiktok: Users,
  other: Users,
}

const TONE: Record<CommunityPlatform, string> = {
  whatsapp: 'bg-success-50 text-success-600',
  telegram: 'bg-brand-50 text-brand-600',
  x: 'bg-ink-100 text-ink-600',
  instagram: 'bg-violet-50 text-violet-600',
  facebook: 'bg-brand-50 text-brand-600',
  tiktok: 'bg-ink-100 text-ink-600',
  other: 'bg-ink-100 text-ink-500',
}

export function CommunityLinks({
  communities,
  title,
  hint,
}: {
  communities: Community[]
  title: string
  hint: string
}) {
  /* Nothing configured is not an empty state worth drawing. The operator adds
     these when they have somewhere to send people; until then the Profile tab
     should look exactly as it did. */
  if (communities.length === 0) return null

  return (
    <section data-tour="communities">
      <h2 className="mb-2 px-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-400 uppercase">
        {title}
      </h2>
      <div className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="divide-y divide-ink-100">
          {communities.map((community) => {
            const Icon = ICON[community.platform] ?? Users
            return (
              <a
                key={community.id}
                href={community.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[3.25rem] items-center gap-3 px-3.5 py-3 transition-colors hover:bg-ink-50"
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-(--radius-input)',
                    TONE[community.platform] ?? TONE.other,
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-ink-900">
                  {community.name}
                </span>
                <ExternalLink aria-hidden className="size-4 shrink-0 text-ink-400" />
              </a>
            )
          })}
        </div>
      </div>
      <p className="mt-2 px-1 text-[0.75rem] leading-relaxed text-ink-400">{hint}</p>
    </section>
  )
}
