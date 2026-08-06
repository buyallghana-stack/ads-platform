import {
  Award,
  Check,
  Layers,
  Minus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import type { TrainingOffer } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * The join screen — what somebody with no affiliate account sees at /market.
 *
 * ── WHAT IS BEING SOLD, AND WHY THE SCREEN LEADS WITH DEPTH ──
 *
 * The two programs cost GHS 150 and GHS 400 and are otherwise identical in
 * every field except one: `commission_depth`. Beginner pays on sales you make;
 * Professional also pays an override on sales made by affiliates you bring in.
 * Same validity, same certificate, same threshold.
 *
 * So the screen is built around that one difference. The reference's plan cards
 * list six ticks each and differ on two — which is the standard SaaS pricing
 * table, and it works there because those products genuinely differ in six
 * ways. Padding our list to six would mean inventing five, and a feature list
 * that has to be padded is a list the reader will discover is padded.
 *
 * Every row in these lists is a field on `training_programs`. Nothing is
 * claimed that the database cannot be asked to confirm.
 *
 * ── WHY THERE IS NO "MOST POPULAR" BADGE ──
 *
 * The reference has one. We have no sales, so it would be a fabrication, and
 * on a screen taking GHS 400 from somebody it is exactly the kind of
 * fabrication that matters. The recommendation is instead stated as what it
 * is: the program that pays on two levels, marked as the fuller one.
 */

function Row({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-start gap-2.5 text-[0.8125rem]', on ? 'text-ink-800' : 'text-ink-400')}>
      <span
        aria-hidden
        className={cn(
          'mt-px grid size-[1.125rem] shrink-0 place-items-center rounded-full',
          on ? 'bg-success-500/15 text-success-600' : 'bg-ink-100 text-ink-400',
        )}
      >
        {on ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={3} />}
      </span>
      <span className="leading-snug">{children}</span>
    </li>
  )
}

async function OfferCard({ offer, featured }: { offer: TrainingOffer; featured: boolean }) {
  const t = await getTranslations('affiliate.join')
  const twoLevel = offer.depth >= 2
  const years = Math.round(offer.validity_days / 365)

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-(--radius-panel) border p-5',
        featured
          ? 'border-brand-600 bg-brand-50 shadow-[0_20px_44px_-24px_rgb(124_58_237/0.8)]'
          : 'border-ink-200 bg-surface',
      )}
    >
      {featured && (
        <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-[0.6875rem] font-semibold text-white">
          <Sparkles aria-hidden className="size-3" />
          {t('fullest')}
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
          {offer.title}
        </h3>
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-(--radius-card)',
            twoLevel ? 'bg-brand-600/15 text-brand-700' : 'bg-teal-50 text-teal-600',
          )}
        >
          {twoLevel ? <Layers className="size-4.5" /> : <Users className="size-4.5" />}
        </span>
      </div>

      {offer.description && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">{offer.description}</p>
      )}

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-[0.9375rem] font-semibold text-ink-500">GHS</span>
        <span className="text-[2rem] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink-900">
          {(offer.price_minor / 100).toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
        <span className="text-[0.8125rem] text-ink-500">
          {years === 1 ? t('perYear') : t('perPeriod', { n: offer.validity_days })}
        </span>
      </p>

      {/* Renewals are cheaper than the first year and the reference has nowhere
          to say so. It belongs here, on the screen where the price is being
          weighed, not in a support article discovered eleven months later. */}
      {offer.renewal_price_minor !== null && offer.renewal_price_minor < offer.price_minor && (
        <p className="mt-1 text-[0.75rem] text-ink-500">
          {t('renewsAt', { amount: cedis(offer.renewal_price_minor) })}
        </p>
      )}

      <ul className="mt-4 flex flex-1 flex-col gap-2.5 border-t border-ink-200 pt-4">
        <Row on>{t('featureOwnSales')}</Row>
        <Row on={twoLevel}>{t('featureOverride')}</Row>
        <Row on>{t('featureLessons', { n: offer.lessons })}</Row>
        <Row on={offer.certificate}>{t('featureCertificate')}</Row>
        <Row on>{t('featureValidity', { n: offer.validity_days })}</Row>
      </ul>

      <Link
        href={`/shop/${offer.slug}`}
        className={cn(
          'mt-5 inline-flex items-center justify-center rounded-(--radius-input) px-4 py-3 text-[0.875rem] font-semibold transition-colors',
          featured
            ? 'bg-brand-600 text-white hover:bg-brand-500'
            : 'border border-brand-600/40 text-brand-700 hover:border-brand-600 hover:bg-brand-50',
        )}
      >
        {t('choose', { title: offer.level === 'professional' ? t('pro') : t('starter') })}
      </Link>

      {/* The activation threshold is a condition of the sale, so it is stated
          under the button that agrees to it, not buried in the course. */}
      <p className="mt-2.5 flex items-start gap-1.5 text-[0.6875rem] leading-snug text-ink-500">
        <Award aria-hidden className="mt-px size-3.5 shrink-0" />
        {t('thresholdNote', { n: offer.threshold })}
      </p>
    </div>
  )
}

export async function JoinPanel({ offers }: { offers: TrainingOffer[] }) {
  const t = await getTranslations('affiliate.join')

  return (
    <div className="flex flex-col gap-5">
      {/* Hero. The reference's headline is "Unlock your earning potential",
          which is the copy of a product that will not say what it does. Ours
          states the actual proposition in one line, because the audience is
          being asked for GHS 150 and deserves to know what for. */}
      <section className="relative isolate overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-6 sm:px-7 sm:py-8">
        <div
          aria-hidden
          className="absolute -right-16 -top-24 -z-10 size-64 rounded-full bg-brand-600/20 blur-3xl"
        />
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand-700">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 max-w-lg text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink-900 sm:text-[1.875rem]">
          {t('title')}
        </h1>
        <p className="mt-2.5 max-w-xl text-[0.875rem] leading-relaxed text-ink-600">{t('body')}</p>

        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
          {[
            { key: 'chipReal', Icon: Zap },
            { key: 'chipYear', Icon: RefreshCw },
            { key: 'chipCert', Icon: Award },
          ].map(({ key, Icon }) => (
            <li key={key} className="flex items-center gap-2 text-[0.8125rem] text-ink-700">
              <span className="grid size-6 place-items-center rounded-full bg-brand-50 text-brand-700">
                <Icon aria-hidden className="size-3.5" />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </section>

      {offers.length === 0 ? (
        <p className="rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-8 text-center text-[0.875rem] text-ink-500">
          {t('noneOnSale')}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {offers.map((offer) => (
            <OfferCard key={offer.product_id} offer={offer} featured={offer.depth >= 2} />
          ))}
        </div>
      )}

      {/* ── HOW COMMISSION IS PAID ───────────────────────────────────────
          The reference's equivalent block is "Secure & trusted: we use
          industry-leading encryption", which is a sentence about the payment
          processor dressed up as a sentence about the product. It reassures
          nobody who was actually worried and it says nothing true that is not
          also true of every website.

          The real question somebody has before paying to become an affiliate
          is "when does the money reach me, and can it be taken back". So this
          block answers that instead. */}
      <section className="rounded-(--radius-panel) border border-ink-200 bg-ink-50 px-5 py-5">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink-900">
          <ShieldCheck aria-hidden className="size-4.5 text-brand-700" />
          {t('howTitle')}
        </h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {['howOne', 'howTwo', 'howThree'].map((key, i) => (
            <li key={key} className="flex gap-2.5">
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600/15 text-[0.75rem] font-bold text-brand-700"
              >
                {i + 1}
              </span>
              <span className="text-[0.8125rem] leading-snug text-ink-600">{t(key)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
