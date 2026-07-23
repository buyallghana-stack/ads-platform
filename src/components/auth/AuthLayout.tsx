import { getTranslations } from 'next-intl/server'

import { QuoteCarousel } from '@/components/auth/QuoteCarousel'
import { Logo } from '@/components/brand/Logo'
import { PanelArtwork } from '@/components/brand/PanelArtwork'
import { cn } from '@/lib/cn'

/**
 * Split-panel shell for every auth screen.
 *
 * Responsive behaviour, which is the part the reference could not show:
 *
 *   mobile  (<768px)   The blue panel would eat the fold on a small screen, so
 *                      it collapses to a compact header strip. The form is the
 *                      only thing that matters on a phone.
 *   tablet  (768px+)   Split appears. The panel narrows to ~38% and drops the
 *                      testimonial, keeping headline and artwork — there is not
 *                      enough height in landscape for all three.
 *   desktop (1280px+)  Full reference layout: 46% panel, headline, body copy
 *                      and rotating testimonial.
 *
 * The panel is decorative and comes second in the DOM on small screens, so
 * keyboard and screen-reader users reach the form first.
 */
export async function AuthLayout({
  children,
  compact = false,
}: {
  children: React.ReactNode
  /** Narrower form column, for short screens like OTP entry. */
  compact?: boolean
}) {
  const t = await getTranslations('auth.panel')
  const headline = t('headline')

  return (
    <div className="flex min-h-dvh flex-col bg-ink-100 md:flex-row">
      {/* ---------------------------------------------------------------- */}
      {/* Brand panel                                                       */}
      {/* ---------------------------------------------------------------- */}
      <aside
        className={cn(
          'bg-brand-panel relative isolate overflow-hidden',
          // Mobile: a strip, not a panel.
          'px-6 py-6',
          // Tablet and up: a real column.
          'md:flex md:w-[38%] md:flex-col md:justify-between md:px-8 md:py-10',
          'xl:w-[46%] xl:px-14 xl:py-14',
        )}
      >
        <PanelArtwork
          className={cn(
            'pointer-events-none absolute -z-10 select-none',
            // Off-canvas on mobile so the strip stays quiet.
            '-right-24 -top-40 hidden size-[420px] opacity-60',
            'md:block md:-bottom-32 md:-right-32 md:top-auto md:size-[520px]',
            'xl:size-[680px]',
          )}
        />

        <Logo variant="light" />

        {/* Headline and testimonial: tablet and up only. */}
        <div className="hidden md:mt-10 md:block xl:mt-0">
          <h1 className="max-w-[16ch] whitespace-pre-line text-[2rem] font-semibold leading-[1.12] tracking-[-0.03em] text-white xl:text-[2.75rem]">
            {headline}
          </h1>
          <p className="mt-4 max-w-[42ch] text-[0.9375rem] leading-relaxed text-white/80">
            {t('body')}
          </p>
        </div>

        {/* Testimonial needs vertical room; desktop only. */}
        <QuoteCarousel className="hidden xl:block" />
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Form column                                                       */}
      {/* ---------------------------------------------------------------- */}
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 md:px-10 md:py-12">
        <div className={cn('w-full', compact ? 'max-w-[26rem]' : 'max-w-[27.5rem]')}>
          {children}
        </div>
      </main>
    </div>
  )
}
