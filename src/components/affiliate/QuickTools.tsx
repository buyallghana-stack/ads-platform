import { FileText, Link2, Store, Wallet } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'

/**
 * Shortcuts under the funnel figures.
 *
 * ── FOUR, NOT THE REFERENCE'S FIVE ──
 *
 * The reference row is Share Link, Banners, Promo Tools, Reports, Payouts.
 * Three of those describe features that do not exist — there is no creative
 * library, no promo builder and no report generator — and the operator's
 * ruling (2026-08-06) was to ship only what is real rather than to grey three
 * tiles out as "soon".
 *
 * That is the better call for a row whose entire purpose is speed. A shortcut
 * strip is scanned, not read; three dead tiles in five means most of what the
 * eye lands on does nothing, and the two live ones get slower to find rather
 * than faster. The ads dashboard greys its Games tile because that feature is
 * BUILT and waiting on a licensing decision — a different situation from a
 * feature nobody has started.
 *
 * So the row is four things that all go somewhere: find something to promote,
 * copy your link, read the statement, get paid.
 */

const TOOLS = [
  { key: 'browse', href: '/shop', Icon: Store, tone: 'text-brand-700 bg-brand-50' },
  { key: 'links', href: '/market/account', Icon: Link2, tone: 'text-teal-600 bg-teal-50' },
  { key: 'statement', href: '/commission', Icon: FileText, tone: 'text-orange-600 bg-orange-50' },
  { key: 'payouts', href: '/commission#payouts', Icon: Wallet, tone: 'text-success-600 bg-success-50' },
] as const

export async function QuickTools() {
  const t = await getTranslations('affiliate.tools')

  return (
    <nav
      aria-label={t('label')}
      className="rounded-(--radius-panel) border border-ink-200 bg-surface p-3"
    >
      <p className="px-1 pb-2 text-[0.8125rem] font-semibold text-ink-900">{t('title')}</p>
      <ul className="grid grid-cols-4 gap-1">
        {TOOLS.map(({ key, href, Icon, tone }) => (
          <li key={key}>
            <Link
              href={href}
              className="flex flex-col items-center gap-2 rounded-(--radius-card) px-1 py-2.5 text-ink-700 transition-colors hover:bg-ink-100"
            >
              <span className={`grid size-11 place-items-center rounded-(--radius-card) ${tone}`}>
                <Icon aria-hidden className="size-[1.15rem]" />
              </span>
              <span className="text-center text-[0.6875rem] font-medium leading-tight">
                {t(key)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
