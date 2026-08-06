import { Layers } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { OfferPanel, PanelAction } from '@/components/market/OfferPanel'
import { cedis } from '@/lib/market/money'
import type { TrainingOffer } from '@/lib/market/data'

/**
 * What somebody with no affiliate account sees on the Market dashboard.
 *
 *   "if no purchase of the training program is made should only display
 *    the pricing there"  — operator, 2026-08-06
 *
 * So: the courses and what they cost. No statistics, no explanation of a
 * programme they have not joined, no preview of a dashboard they cannot fill.
 *
 * ---------------------------------------------------------------------------
 * THE COMPARISON IS ONE FACT, NOT A FEATURE TABLE
 *
 * The two courses teach the same material. The ONLY thing that differs is how
 * far the commission reaches — one level or two — so that is the difference the
 * panels lead with. A feature matrix would invent distinctions that do not
 * exist in order to fill it.
 *
 * ---------------------------------------------------------------------------
 * NO EARNINGS CLAIM
 *
 * Not a projection, not an average, not "affiliates typically…". This is the
 * screen where an income claim would most naturally appear and it is the exact
 * thing that turns a defensible programme into an indefensible one
 * (DECISIONS.md §6). What it says is what you get and what it costs.
 */
export async function TrainingOffers({ offers }: { offers: TrainingOffer[] }) {
  const t = await getTranslations('market.training')

  if (offers.length === 0) {
    return (
      <div className="rounded-(--radius-panel) border border-dashed border-ink-300 bg-surface px-4 py-12 text-center">
        <Layers aria-hidden className="mx-auto size-7 text-ink-400" strokeWidth={1.5} />
        <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{t('soon.title')}</p>
        <p className="mx-auto mt-1 max-w-sm text-[0.875rem] leading-snug text-ink-600">
          {t('soon.body')}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {offers.map((offer) => {
        const two = offer.depth >= 2
        return (
          <OfferPanel
            key={offer.product_id}
            tone={two ? 'earn' : 'buy'}
            label={offer.title}
            headline={cedis(offer.price_minor)}
            sub={t(two ? 'professional.summary' : 'beginner.summary')}
            benefits={[
              <span key="levels">{t('perks.levels', { n: offer.depth })}</span>,
              <span key="year">{t('perks.year')}</span>,
              <span key="keep">{t('perks.keep')}</span>,
              <span key="cert">{t('perks.certificate')}</span>,
            ]}
          >
            <PanelAction href={`/shop/${offer.slug}`}>{t('cta')}</PanelAction>
          </OfferPanel>
        )
      })}
    </div>
  )
}
