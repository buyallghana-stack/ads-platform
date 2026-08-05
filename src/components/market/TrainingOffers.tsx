import { Check, Layers } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import type { TrainingOffer } from '@/lib/market/data'

/**
 * What somebody with no affiliate account sees.
 *
 * This is a sales screen, and the honest one is better than the enthusiastic
 * one: paid entry into a programme that pays for recruiting is the part of
 * Phase 2 under real regulatory scrutiny (DECISIONS.md §6). Copy that promises
 * earnings is the single fastest way to turn a defensible structure into an
 * indefensible one, so this screen states what you get and what it costs, and
 * makes no claim about what you will make.
 *
 * The two courses differ in exactly one thing that matters — one commission
 * level or two — so that difference is the comparison, stated in words rather
 * than left for the reader to infer from a feature list.
 *
 * EMPTY IS A REAL STATE. Both courses ship as `draft`, so until the operator
 * publishes them this list is empty for everybody. It must not render as a
 * broken page.
 */
export async function TrainingOffers({ offers }: { offers: TrainingOffer[] }) {
  const t = await getTranslations('market.training')

  if (offers.length === 0) {
    return (
      <div className="rounded-(--radius-card) border border-dashed border-ink-300 bg-surface px-4 py-10 text-center">
        <Layers aria-hidden className="mx-auto size-6 text-ink-400" />
        <p className="mt-3 text-sm font-semibold text-ink-900">{t('soon.title')}</p>
        <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-600">
          {t('soon.body')}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {offers.map((offer) => {
        const two = offer.depth >= 2
        return (
          <div
            key={offer.product_id}
            className="flex flex-col rounded-(--radius-card) border border-ink-200 bg-surface p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-ink-900">{offer.title}</h2>
              <p className="shrink-0 text-lg font-semibold tabular-nums text-ink-900">
                {cedis(offer.price_minor)}
              </p>
            </div>

            <p className="mt-1 text-[0.8125rem] leading-snug text-ink-600">
              {t(two ? 'professional.summary' : 'beginner.summary')}
            </p>

            <ul className="mt-4 flex-1 space-y-2">
              {[
                t('perks.levels', { n: offer.depth }),
                t('perks.year'),
                t('perks.keep'),
                t('perks.certificate'),
              ].map((line) => (
                <li key={line} className="flex gap-2.5 text-[0.8125rem] leading-snug text-ink-700">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-jade-600" />
                  {line}
                </li>
              ))}
            </ul>

            <Link
              href={`/shop/${offer.slug}`}
              className="mt-5 flex items-center justify-center rounded-(--radius-input) bg-jade-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-jade-700"
            >
              {t('cta')}
            </Link>
          </div>
        )
      })}
    </div>
  )
}
