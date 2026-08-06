'use client'

import { useState } from 'react'
import { Check, Copy, Link2, Lock } from 'lucide-react'

import { OfferPanel, PanelAction } from '@/components/market/OfferPanel'
import { cn } from '@/lib/cn'
import { cedis } from '@/lib/market/money'

export type PromoteInfo = {
  ok: boolean
  canPromote?: boolean
  reason?: 'no_account' | 'pending' | 'lapsed' | 'tier' | 'suspended' | null
  code?: string | null
  tier?: 'beginner' | 'professional' | null
  depth?: number
  minTier?: 'beginner' | 'professional'
  priceMinor?: number
  l1Rate?: number | null
  l2Rate?: number | null
  l1EarnMinor?: number | null
  l2EarnMinor?: number | null
  windowDays?: number
  holdDays?: number
}

/**
 * What an affiliate sees instead of — and alongside — the buy panel.
 *
 * ---------------------------------------------------------------------------
 * CASH, NOT PERCENTAGES
 *
 * The headline is "GHS 30.00" and the rate is the working underneath. A rate is
 * a fact about the programme; a cash figure is a fact about THIS sale, and it
 * is the one an affiliate is otherwise computing in their head on a phone.
 *
 * ⚠️ The figure is computed in Postgres by `affiliate_promote_info`, using the
 * same price source and the same rounding `pay_conversion_commissions` uses.
 * Multiplying here would let the number shown drift from the number paid — and
 * the shown one is the one that gets screenshotted.
 *
 * ---------------------------------------------------------------------------
 * FOUR REFUSALS, FOUR SENTENCES, FOUR DESTINATIONS
 *
 * There is no `canPromote: false` path that just says no. Each reason names
 * what is missing and points at the thing that fixes it, because somebody
 * reading this panel is trying to give us money and the least useful possible
 * reply is "you can't".
 */
export function PromotePanel({
  info,
  productSlug,
  origin,
}: {
  info: PromoteInfo
  productSlug: string
  /** Absolute site origin, resolved on the server — `window.location` is not
   *  available when this renders and the link has to be copyable, not relative. */
  origin: string
}) {
  const [copied, setCopied] = useState(false)

  if (!info.ok) return null

  const link = info.code ? `${origin}/shop/${productSlug}?ref=${info.code}` : null

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* Clipboard is refused on insecure origins and in some in-app browsers,
         which is a real case for this audience. The input below is selectable,
         so there is always a manual way — the button simply does not confirm. */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Cannot promote — say which of the four, and where to go            */
  /* ---------------------------------------------------------------- */
  if (!info.canPromote) {
    const REASONS: Record<string, { line: string; cta?: string; href?: string }> = {
      no_account: {
        line: 'Take an affiliate training course and you can earn on every sale you send here.',
        cta: 'See the training',
        href: '/market',
      },
      pending: {
        line: 'Finish enough of your course and promoting switches on.',
        cta: 'Continue the course',
        href: '/learn',
      },
      lapsed: {
        line: 'Your year of promoting has ended. Renew it to start earning again.',
        cta: 'Renew',
        href: '/market',
      },
      tier: {
        line: 'This product needs the Professional course. Upgrading takes the difference off what you already paid.',
        cta: 'Upgrade',
        href: '/market',
      },
      suspended: {
        line: 'Your affiliate account is suspended. Message support and we will look at it.',
        cta: 'Message support',
        href: '/support',
      },
    }
    const reason = REASONS[info.reason ?? 'no_account'] ?? REASONS.no_account

    return (
      <OfferPanel
        tone="earn"
        muted
        label="Earn from this"
        headline={
          <span className="inline-flex items-center gap-2 text-ink-500">
            <Lock aria-hidden className="size-5" />
            <span className="text-[1.25rem]">Not yet</span>
          </span>
        }
        sub={reason!.line}
      >
        {reason!.cta && reason!.href && (
          <PanelAction variant="outline" href={reason!.href}>
            {reason!.cta}
          </PanelAction>
        )}
      </OfferPanel>
    )
  }

  /* ---------------------------------------------------------------- */
  /* Can promote                                                       */
  /* ---------------------------------------------------------------- */
  const benefits: React.ReactNode[] = [
    <>
      Your link is remembered for <strong className="font-semibold">{info.windowDays} days</strong>
      {' '}after someone opens it
    </>,
    info.holdDays === 0 ? (
      <>Commission lands as soon as the sale is confirmed</>
    ) : (
      <>Commission clears {info.holdDays} days after the sale</>
    ),
  ]

  /* Level two only for somebody who actually has it. Showing a locked
     second-level figure to a Beginner is an advert for the upgrade dressed up
     as information, and it makes the panel harder to read for everyone. */
  if (info.l2EarnMinor != null && (info.depth ?? 0) >= 2) {
    benefits.push(
      <>
        Plus <strong className="font-semibold">{cedis(info.l2EarnMinor)}</strong> when an affiliate
        you brought in sells it
      </>,
    )
  }

  return (
    <OfferPanel
      tone="earn"
      label="Earn from this"
      headline={
        <>
          {cedis(info.l1EarnMinor ?? 0)}
          <span className="ml-1.5 text-[0.9375rem] font-medium text-ink-600">per sale</span>
        </>
      }
      sub={`${info.l1Rate}% of ${cedis(info.priceMinor ?? 0)} — what the buyer actually pays`}
      benefits={benefits}
      footnote="Self-referrals do not pay. Renewals do not pay commission at any level."
    >
      <div className="space-y-2.5">
        {/* The link is visible, not just copyable. Clipboard access is refused
            on insecure origins and inside some in-app browsers, which is a real
            case here — so there is always a manual way to get the link out. */}
        <div className="flex items-center gap-2 rounded-full border border-jade-600/30 bg-surface px-3.5 py-2.5">
          <Link2 aria-hidden className="size-4 shrink-0 text-jade-700" />
          <input
            readOnly
            value={link ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Your promotion link"
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink-700 outline-none pointer-coarse:text-base"
          />
        </div>

        <PanelAction onClick={copy}>
          {copied ? (
            <>
              <Check aria-hidden className="size-4" strokeWidth={2.5} />
              Link copied
            </>
          ) : (
            <>
              <Copy aria-hidden className="size-4" />
              Copy my link
            </>
          )}
        </PanelAction>
      </div>
    </OfferPanel>
  )
}

export { cn }
