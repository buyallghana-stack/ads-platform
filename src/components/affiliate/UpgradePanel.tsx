import { ArrowUpRight, Check, TrendingUp } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'

export type UpgradeOffer = {
  product_id: string
  slug: string
  title: string
  description: string | null
  level: string
  price_minor: number
  /** What the upgrade actually costs: the list price less what they paid for
   *  what they already hold. See migration 186. */
  upgrade_minor: number
  lessons: number
  depth: number
  validity_days: number
  certificate: boolean
}

/**
 * The next training level up, offered where a subscription belongs.
 *
 * ── WHY THE PROFILE AND NOT THE SHOP ──
 *
 * Operator, 2026-08-08: training is a subscription rather than a product, so
 * it came off the products screen. That leaves one honest place for the level
 * above yours — beside the training you already hold, on the profile, where
 * the rest of what you HOLD lives.
 *
 * ── IT DISAPPEARS BY ITSELF ──
 *
 * `training_upgrade_offer` returns the lowest published level ABOVE the
 * highest one owned, so Beginner stops being offered the moment Professional
 * is bought and this panel renders nothing at all once there is nothing above
 * you. That is the operator's "the beginner course automatically vanishes",
 * done in the read rather than in a condition every screen has to remember.
 *
 * ⚠️ It reads `entitlements`, the record of the PURCHASE, not
 * `affiliate_entitlements`, which is the right to earn and expires. Somebody
 * whose affiliate entitlement lapsed still bought the course; offering it back
 * to them would be selling the same thing twice.
 */
export async function UpgradePanel({ offer }: { offer: UpgradeOffer | null }) {
  const t = await getTranslations('affiliate.upgrade')
  if (!offer) return null

  const benefits = [
    t('benefitLessons', { n: offer.lessons }),
    offer.depth >= 2 ? t('benefitDepth') : null,
    t('benefitValidity', { days: offer.validity_days }),
    offer.certificate ? t('benefitCertificate') : null,
  ].filter((b) => b !== null)

  return (
    <section className="rounded-(--radius-panel) border border-violet-600/30 bg-violet-500/8 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-500/15 text-violet-600"
        >
          <TrendingUp className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold text-ink-900">{t('title')}</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-600">
            {t('body', { title: offer.title })}
          </p>
        </div>
      </div>

      <ul className="mt-3.5 flex flex-col gap-1.5">
        {benefits.map((b) => (
          <li key={b} className="flex items-start gap-2 text-[0.8125rem] text-ink-700">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-violet-600" strokeWidth={2.5} />
            {b}
          </li>
        ))}
      </ul>

      {/* Everything already bought stays bought: the upgrade is its own
          purchase and its own entitlement, so the lower course, its lessons
          and its certificate are untouched. Nothing has to be re-earned. */}
      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-500">{t('keepsNote')}</p>

      {/* Why the price is lower than the course's own. Without this line a
          GHS 200 button under a GHS 350 course reads as a mistake, and the
          first thing somebody does with a price they distrust is not pay it. */}
      {offer.upgrade_minor != null && offer.upgrade_minor < offer.price_minor && (
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-500">
          {t('differenceNote', {
            full: cedis(offer.price_minor),
            paid: cedis(offer.price_minor - offer.upgrade_minor),
          })}
        </p>
      )}

      <Link
        href={`/p/${offer.slug}`}
        className="mt-4 inline-flex items-center gap-2 rounded-(--radius-input) bg-violet-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-violet-700"
      >
        {/* ⚠️ `upgrade_minor`, NOT `price_minor`. This button advertised the
            full GHS 350 while the upgrade costs the difference, and the
            operator was quoted the wrong figure on the one screen that sells
            it (2026-08-12). `??` rather than a bare read so an older cached
            payload degrades to the honest-but-high number rather than to
            "GHS NaN". */}
        {t('cta', { price: cedis(offer.upgrade_minor ?? offer.price_minor) })}
        <ArrowUpRight aria-hidden className="size-4" />
      </Link>
    </section>
  )
}
