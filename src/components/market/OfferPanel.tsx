import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * A commercial offer, in its own bordered panel.
 *
 * Taken whole from reference 0579 — the single most reusable idea in the set:
 *
 *     ┌──────────────────────────────┐
 *     │  Purchase Course             │  what this panel is
 *     │  US$31.00                    │  the number, large
 *     │  ✓ benefit                   │  what you get
 *     │  ✓ benefit                   │
 *     └──────────────────────────────┘
 *
 * It works because it separates THE OFFER from the description of the product,
 * which is exactly the distinction a shopper is already making. A price sitting
 * loose in a column of prose is something to read; a price inside a bordered
 * panel is something to decide about.
 *
 * Two tones, and the difference is not decoration:
 *   `buy`     spending money — neutral border, near-black action
 *   `earn`    making money — jade border and tint, so an affiliate can tell the
 *             two panels apart from across the room without reading either
 *
 * `muted` is for an offer that is real but not available to this person yet —
 * the promote panel when they have no training. It stays legible and stops
 * competing, rather than being hidden, because the reason it is unavailable is
 * the most useful thing on the screen for them.
 */
export function OfferPanel({
  label,
  headline,
  sub,
  benefits,
  tone = 'buy',
  muted = false,
  footnote,
  children,
  className,
}: {
  /** What this panel is. Small, above the number. */
  label: string
  /** The number, or the thing standing in for it. */
  headline: React.ReactNode
  /** The working underneath — "20% of GHS 150.00". */
  sub?: React.ReactNode
  benefits?: React.ReactNode[]
  tone?: 'buy' | 'earn'
  muted?: boolean
  /** Small print. Terms, timings, the things that prevent support messages. */
  footnote?: React.ReactNode
  /** The action, and anything else that belongs inside the panel. */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-(--radius-card) border p-4 sm:p-5',
        tone === 'earn' && !muted
          ? 'border-jade-600/35 bg-jade-50'
          : 'border-ink-200 bg-surface',
        muted && 'opacity-95',
        className,
      )}
    >
      <p
        className={cn(
          'text-[0.8125rem] font-semibold',
          tone === 'earn' && !muted ? 'text-jade-700' : 'text-ink-700',
        )}
      >
        {label}
      </p>

      <div className="mt-1.5 text-[1.875rem] leading-none font-semibold tracking-[-0.03em] text-ink-900">
        {headline}
      </div>

      {sub && <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-600">{sub}</p>}

      {benefits && benefits.length > 0 && (
        <ul className="mt-3.5 space-y-2">
          {benefits.map((benefit, i) => (
            <li key={i} className="flex gap-2.5 text-[0.875rem] leading-snug text-ink-800">
              <Check
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  tone === 'earn' && !muted ? 'text-jade-600' : 'text-ink-500',
                )}
                strokeWidth={2.5}
              />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      )}

      {children && <div className="mt-4">{children}</div>}

      {footnote && (
        <p className="mt-3 text-[0.75rem] leading-snug text-ink-500">{footnote}</p>
      )}
    </section>
  )
}

/**
 * The one primary action in a panel.
 *
 * Full-width and fully rounded, which is what every reference does — a pill
 * that spans the panel is unmissable on a phone and needs no hunting for.
 *
 * `bg-action` rather than a fixed colour: the skin decides, and it decides
 * differently per theme (near-black on cream, jade on true black). A hardcoded
 * near-black here would vanish in dark mode.
 */
export function PanelAction({
  onClick,
  href,
  disabled,
  variant = 'primary',
  children,
}: {
  onClick?: () => void
  href?: string
  disabled?: boolean
  variant?: 'primary' | 'outline'
  children: React.ReactNode
}) {
  const className = cn(
    'flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5',
    'text-[0.9375rem] font-semibold transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-45',
    variant === 'primary'
      ? 'bg-action text-on-action hover:opacity-90'
      : 'border border-ink-300 text-ink-900 hover:border-ink-400 hover:bg-ink-50',
  )

  if (href && !disabled) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  )
}
