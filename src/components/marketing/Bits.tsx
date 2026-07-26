import { cn } from '@/lib/cn'

/**
 * Small shared pieces of the landing page's visual language.
 *
 * The page is long and the same three devices repeat down it — a coloured
 * eyebrow, a headline with one italic-serif accent word, and a bordered card.
 * Defining them once is what keeps twelve sections looking like one page.
 */

/** The accent hues a section may be keyed to. Deliberately the SAME meanings
 *  the signed-in app already assigns (globals.css): brand = ads and watching,
 *  success = money, violet = plans, orange = referrals. A visitor who signs up
 *  meets the same colour attached to the same idea. */
export type Tone = 'brand' | 'success' | 'violet' | 'orange' | 'teal'

const EYEBROW_TONE: Record<Tone, string> = {
  brand: 'text-brand-700',
  success: 'text-success-700',
  violet: 'text-violet-700',
  orange: 'text-orange-700',
  teal: 'text-teal-700',
}

const TILE_TONE: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600 ring-brand-600/20',
  success: 'bg-success-50 text-success-600 ring-success-600/20',
  violet: 'bg-violet-50 text-violet-600 ring-violet-600/20',
  orange: 'bg-orange-50 text-orange-600 ring-orange-600/20',
  teal: 'bg-teal-50 text-teal-600 ring-teal-600/20',
}

export function Eyebrow({
  icon,
  tone = 'brand',
  children,
  className,
}: {
  icon?: React.ReactNode
  tone?: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold tracking-[0.02em] uppercase',
        EYEBROW_TONE[tone],
        className,
      )}
    >
      {icon && <span aria-hidden className="[&>svg]:size-4">{icon}</span>}
      {children}
    </p>
  )
}

/** A tinted square holding one outline icon — the section and feature marker. */
export function IconTile({
  tone = 'brand',
  size = 'md',
  children,
  className,
}: {
  tone?: Tone
  size?: 'md' | 'lg'
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-(--radius-input) ring-1',
        size === 'lg' ? 'size-12 [&>svg]:size-6' : 'size-10 [&>svg]:size-5',
        TILE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * A headline where one span is set in the italic display serif.
 *
 * The copy carries the split rather than the component guessing at it: each
 * translated string is stored as two halves (`…title` and `…accent`), so a
 * French headline can put its accent word somewhere an English one would not.
 */
export function Display({
  title,
  accent,
  as: Tag = 'h2',
  className,
}: {
  title: string
  accent?: string
  as?: 'h1' | 'h2'
  className?: string
}) {
  return (
    <Tag
      className={cn(
        'font-semibold tracking-[-0.03em] text-balance text-ink-900',
        Tag === 'h1'
          ? 'text-[2.125rem] leading-[1.08] sm:text-[3rem] lg:text-[3.5rem]'
          : 'text-[1.75rem] leading-[1.12] sm:text-[2.25rem]',
        className,
      )}
    >
      {title}
      {accent && (
        <>
          {' '}
          {/* Optical fix, not decoration: the serif's italic lean crowds the
              character after it and its cap-height sits below Inter's, so it
              needs a touch more size and a sliver of trailing space. */}
          <span className="font-display text-[1.06em] font-normal tracking-[-0.01em] italic">
            {accent}
          </span>
        </>
      )}
    </Tag>
  )
}

/** Centred section header: eyebrow, display headline, one line of lead. */
export function SectionHead({
  eyebrow,
  eyebrowIcon,
  tone = 'brand',
  title,
  accent,
  lead,
  align = 'center',
  className,
}: {
  eyebrow?: string
  eyebrowIcon?: React.ReactNode
  tone?: Tone
  title: string
  accent?: string
  lead?: string
  align?: 'center' | 'start'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {eyebrow && (
        <Eyebrow icon={eyebrowIcon} tone={tone}>
          {eyebrow}
        </Eyebrow>
      )}
      <Display title={title} accent={accent} />
      {lead && (
        <p
          className={cn(
            'text-[1.0625rem] leading-relaxed text-pretty text-ink-600',
            align === 'center' && 'max-w-2xl',
          )}
        >
          {lead}
        </p>
      )}
    </div>
  )
}

/** Full-bleed page section with the shared max width and vertical rhythm. */
export function Section({
  id,
  className,
  innerClassName,
  children,
}: {
  id?: string
  className?: string
  innerClassName?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className={cn('scroll-mt-16 px-4 py-16 sm:px-6 sm:py-20 lg:py-24', className)}>
      <div className={cn('mx-auto max-w-[76rem]', innerClassName)}>{children}</div>
    </section>
  )
}

/** Outlined pill used for "New", "Live now", "Coming next". */
export function Chip({
  tone = 'brand',
  children,
  className,
}: {
  tone?: Tone | 'neutral'
  children: React.ReactNode
  className?: string
}) {
  const tones: Record<Tone | 'neutral', string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
    success: 'bg-success-50 text-success-700 ring-success-600/20',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    orange: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    teal: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    neutral: 'bg-ink-100 text-ink-600 ring-ink-300/40',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
