import { getTranslations } from 'next-intl/server'

import { QuoteCarousel } from '@/components/auth/QuoteCarousel'
import { Logo } from '@/components/brand/Logo'
import { PanelArtwork } from '@/components/brand/PanelArtwork'
import { cn } from '@/lib/cn'

/**
 * Split-panel shell for every auth screen.
 *
 * A single white card floating on a light field, with the brand panel inset
 * inside it — the arrangement in the operator's reference. The inset matters:
 * a blue block running edge to edge inside a white card looks like a mistake,
 * while an inset block with its own radius reads as deliberate.
 *
 * Responsive behaviour, which the reference could not show:
 *   mobile  (<768px)   Card drops its chrome and the panel becomes a slim
 *                      header. A half-screen blue block eats the fold on a
 *                      phone, and the form is the only thing that matters
 *                      there.
 *   tablet  (768px+)   Split appears at 42%. Headline and body copy stay; the
 *                      testimonial is dropped, since landscape lacks the
 *                      height for all three without crowding.
 *   desktop (1280px+)  Full layout: 46% panel plus rotating testimonial.
 *
 * The panel is decorative, so on small screens the form still comes first for
 * keyboard and screen-reader users.
 */
export async function AuthLayout({
  children,
  compact = false,
}: {
  children: React.ReactNode
  /** Narrower form column, for short screens like code entry. */
  compact?: boolean
}) {
  const t = await getTranslations('auth.panel')

  return (
    <div className="flex min-h-dvh flex-col bg-ink-100 md:items-center md:justify-center md:p-6 lg:p-8">
      <div
        className={cn(
          'flex w-full flex-1 flex-col overflow-hidden bg-white',
          // Card chrome only once there is room around it.
          'md:max-w-[64rem] md:flex-none md:flex-row md:rounded-[--radius-panel]',
          'md:min-h-[38rem]',
          'md:border md:border-ink-200 md:shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-12px_rgb(15_23_42/0.12)]',
        )}
      >
        {/* -------------------------------------------------------------- */}
        {/* Brand panel                                                     */}
        {/* -------------------------------------------------------------- */}
        <aside
          className={cn(
            'bg-brand-panel relative isolate overflow-hidden',
            'px-5 py-5',
            'md:flex md:w-[42%] md:shrink-0 md:flex-col',
            // Inset inside the card, with its own radius.
            'md:m-2 md:mr-0 md:rounded-[0.625rem] md:px-7 md:py-8',
            'xl:w-[46%] xl:px-9 xl:py-9',
          )}
        >
          <PanelArtwork className="pointer-events-none absolute inset-0 -z-10 size-full select-none" />

          <Logo variant="light" />

          {/*
            The headline block takes the remaining height and centres inside
            it, rather than three children sharing space via justify-between —
            which left a dead gap under the logo and another above the quote.
          */}
          <div className="hidden md:flex md:flex-1 md:flex-col md:justify-center md:py-8">
            <h1 className="max-w-[14ch] whitespace-pre-line text-[1.875rem] font-semibold leading-[1.12] tracking-[-0.035em] text-white xl:text-[2.375rem]">
              {t('headline')}
            </h1>
            <p className="mt-3.5 max-w-[36ch] text-[0.8125rem] leading-relaxed text-white/70 xl:text-sm">
              {t('body')}
            </p>

            {/*
              Concrete benefits rather than more prose. The panel was tall and
              underfilled, and empty space in a brand panel reads as unfinished
              — but padding it with another paragraph would have been filler.
              These answer the question a new visitor actually has.
            */}
            <ul className="mt-7 flex flex-col gap-2.5">
              {(t.raw('features') as string[]).map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-[0.8125rem] text-white/85">
                  <svg
                    aria-hidden
                    viewBox="0 0 20 20"
                    className="mt-px size-4 shrink-0"
                    fill="none"
                  >
                    <circle cx="10" cy="10" r="9" fill="#fff" fillOpacity="0.16" />
                    <path
                      d="M6.5 10.2l2.4 2.3 4.6-4.9"
                      stroke="#fff"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <QuoteCarousel className="hidden xl:block" />
        </aside>

        {/* -------------------------------------------------------------- */}
        {/* Form column                                                     */}
        {/* -------------------------------------------------------------- */}
        {/*
          items-start on mobile: vertically centring the form in the remaining
          viewport left a dead gap under the header strip and pushed the
          submit button below the fold. Centring only earns its keep once the
          card is a fixed height.
        */}
        <main className="flex flex-1 items-start justify-center px-5 py-7 sm:px-8 md:items-center md:px-9 md:py-10 xl:px-12">
          <div className={cn('w-full', compact ? 'max-w-[21rem]' : 'max-w-[23rem]')}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
