import { BarChart3, MousePointerClick, ShoppingBag, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { conversionRate } from '@/lib/market/money'

/**
 * The four funnel figures, in one card divided into columns.
 *
 * ── WHY ONE CARD AND NOT FOUR ──
 *
 * These are not four independent statistics; they are one funnel read left to
 * right — clicks arrive, some become customers, some of those buy, and the
 * last column is the ratio of the two ends. Four separate cards would let a
 * responsive grid reflow them out of order, which destroys the only structure
 * they have. Inside one card the order is fixed and the dividers say "these
 * belong together".
 *
 * ── THE RATE IS NULL, NOT ZERO, WITH NO CLICKS ──
 *
 * `conversionRate` returns null rather than "0.0%" when nothing has been
 * clicked. Zero conversions on 400 clicks is a real problem worth showing;
 * zero clicks is simply nothing to divide by, and printing 0.0% for the second
 * makes a brand-new affiliate look like a failing one on their first visit.
 *
 * At 390px four columns leave ~85px each, which fits a four-digit tabular
 * figure and a one-word label. A fifth column would not, which is why the
 * network figure lives on its own row below rather than being squeezed in.
 */
export async function StatStrip({
  clicks,
  customers,
  conversions,
}: {
  clicks: number
  /** Distinct people who arrived through this affiliate's links. */
  customers: number
  conversions: number
}) {
  const t = await getTranslations('affiliate.stats')
  const rate = conversionRate(conversions, clicks)

  const items = [
    { key: 'clicks', value: clicks.toLocaleString(), Icon: MousePointerClick, tone: 'text-brand-700' },
    { key: 'customers', value: customers.toLocaleString(), Icon: Users, tone: 'text-teal-600' },
    { key: 'conversions', value: conversions.toLocaleString(), Icon: ShoppingBag, tone: 'text-success-600' },
    { key: 'rate', value: rate ?? '—', Icon: BarChart3, tone: 'text-orange-600' },
  ] as const

  return (
    <section
      aria-label={t('label')}
      className="grid grid-cols-4 rounded-(--radius-panel) border border-ink-200 bg-surface"
    >
      {items.map(({ key, value, Icon, tone }, i) => (
        <div
          key={key}
          className={[
            'flex flex-col items-center gap-1.5 px-1 py-4',
            /* Hairlines BETWEEN, not around: a border on every cell would draw
               a double line down each divider. */
            i > 0 ? 'border-l border-ink-200' : '',
          ].join(' ')}
        >
          <span className={`grid size-9 place-items-center rounded-full bg-ink-50 ${tone}`}>
            <Icon aria-hidden className="size-4.5" />
          </span>
          <span className="text-[1.0625rem] font-semibold leading-none tabular-nums text-ink-900 sm:text-xl">
            {value}
          </span>
          <span className="text-center text-[0.6875rem] leading-tight text-ink-500">{t(key)}</span>
        </div>
      ))}
    </section>
  )
}
