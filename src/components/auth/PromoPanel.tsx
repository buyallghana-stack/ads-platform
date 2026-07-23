import { getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'

/**
 * Right-hand promo panel for the auth card.
 *
 * Follows the operator's reference: a light, airy blue wash carrying a
 * two-tone headline (navy line, then brand-blue line) over a floating
 * product mockup — a miniature of the user dashboard with a success toast
 * and a payout chip drifting off its corners. The mockup shows the product
 * doing the thing the headline promises, which is more credible for a
 * pre-launch platform than invented testimonials.
 *
 * The mockup is decorative: aria-hidden, no live data, and its numbers obey
 * the real economics (1000 pts = GHS 1) so the artwork never contradicts
 * the product.
 */
export async function PromoPanel() {
  const t = await getTranslations('auth.panel')

  return (
    <div className="flex h-full flex-col">
      <Logo variant="dark" />

      <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        {/* Status pill, per the reference's "guard active" badge. */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-500/30 bg-white/80 px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-success-700">
          <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
          {t('badge')}
        </span>

        <h1 className="mt-4 text-[1.75rem] font-bold leading-[1.12] tracking-[-0.03em] xl:text-[2.125rem]">
          <span className="block text-ink-900">{t('headline1')}</span>
          <span className="block text-brand-600">{t('headline2')}</span>
        </h1>

        <p className="mt-3 max-w-[30ch] text-[0.8125rem] leading-relaxed text-ink-600 xl:text-sm">
          {t('body')}
        </p>

        {/* ------------------------------------------------------------ */}
        {/* Floating product mockup — decorative                          */}
        {/* ------------------------------------------------------------ */}
        <div aria-hidden className="relative mt-8 w-full max-w-[19rem] select-none">
          {/* Central card: a miniature of the points dashboard. */}
          <div className="rounded-2xl border border-white/70 bg-white/95 p-4 text-left shadow-[0_2px_4px_rgb(15_23_42/0.04),0_24px_48px_-16px_rgb(0_58_134/0.28)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-[0.6875rem] font-bold text-brand-700">
                  KM
                </span>
                <div>
                  <p className="text-[0.75rem] font-semibold text-ink-900">Kwame M.</p>
                  <p className="text-[0.625rem] text-ink-400">{t('mockup.tier')}</p>
                </div>
              </div>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[0.625rem] font-semibold text-brand-700">
                Gold
              </span>
            </div>

            <div className="mt-3.5">
              <p className="text-[0.625rem] font-medium uppercase tracking-[0.06em] text-ink-400">
                {t('mockup.balance')}
              </p>
              <p className="mt-0.5 text-[1.375rem] font-bold tracking-[-0.02em] text-ink-900">
                12,450 <span className="text-[0.8125rem] font-semibold text-ink-400">pts</span>
              </p>
              <p className="text-[0.6875rem] font-medium text-success-700">≈ GHS 12.45</p>
            </div>

            <div className="mt-3.5">
              <div className="flex items-baseline justify-between text-[0.625rem]">
                <span className="font-medium text-ink-500">{t('mockup.today')}</span>
                <span className="font-semibold tabular-nums text-ink-700">8 / 10</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full w-[80%] rounded-full bg-brand-500" />
              </div>
            </div>
          </div>

          {/* Success toast drifting off the top-right corner. */}
          <div className="absolute -right-3 -top-8 flex rotate-2 items-center gap-2 rounded-xl border border-white/70 bg-white/95 py-2 pl-2 pr-3 shadow-[0_12px_28px_-10px_rgb(0_58_134/0.3)] xl:-right-6">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-50 text-success-600">
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                <path
                  d="M3.5 8.4l3 3 6-6.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="text-left leading-tight">
              <p className="text-[0.6875rem] font-semibold text-ink-900">+50 pts</p>
              <p className="text-[0.5625rem] text-ink-400">{t('mockup.adCompleted')}</p>
            </div>
          </div>

          {/* Payout chip drifting off the bottom-left corner. */}
          <div className="absolute -bottom-7 -left-3 flex -rotate-2 items-center gap-2 rounded-xl border border-white/70 bg-white/95 py-2 pl-2 pr-3 shadow-[0_12px_28px_-10px_rgb(0_58_134/0.3)] xl:-left-6">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-warning-50 text-warning-600">
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                <rect x="2.5" y="1.5" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <div className="text-left leading-tight">
              <p className="text-[0.6875rem] font-semibold text-ink-900">MTN MoMo</p>
              <p className="text-[0.5625rem] text-ink-400">{t('mockup.payoutSent')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
