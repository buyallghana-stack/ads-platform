import { Lock } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'

/**
 * What stands in for the affiliate link before it can pay.
 *
 * ── THE CAVEAT THIS FIXES ──
 *
 * An `affiliate_accounts` row — and therefore a code — is created the moment
 * somebody BUYS a training programme, not when they finish enough of it. So
 * between those two moments the account screen handed out a link, the recruit
 * panel handed out two more, and every one of them recorded clicks that could
 * never pay: `affiliate_promote_info` returns `canPromote: false, reason:
 * pending` the whole time.
 *
 * A link that quietly pays nothing is worse than no link. Somebody sends it to
 * ten people, two of them buy, and they find out afterwards.
 *
 * ── SHOWN, NOT HIDDEN ──
 *
 * The panel says exactly what is missing and how far off they are, because the
 * requirement is the argument for finishing the course. Hiding the feature
 * entirely would make the training look like it buys nothing.
 */
export async function LinksLocked({
  state,
  percent,
  threshold,
}: {
  state: 'none' | 'pending' | 'lapsed' | 'suspended'
  /** How far through the training they are, or null when they have none. */
  percent: number | null
  threshold: number | null
}) {
  const t = await getTranslations('affiliate.linksLocked')
  const pct = percent ?? 0
  const need = threshold ?? 50

  return (
    <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-400"
        >
          <Lock className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold text-ink-900">{t('title')}</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">
            {t(`body.${state}`, { threshold: need })}
          </p>
        </div>
      </div>

      {state === 'pending' && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3 text-[0.75rem] text-ink-500">
            <span>{t('progress', { percent: pct })}</span>
            <span className="tabular-nums">{t('needed', { threshold: need })}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <span
              className="block h-full rounded-full bg-brand-600"
              style={{ width: `${Math.min((pct / Math.max(need, 1)) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ⚠️ THREE STATES, NOT TWO (operator, 2026-08-12: "continue training
          when clicked shows no course at the learn tab"). `percent` is null
          when the person owns no training at all, and a number when they own
          it and are partway through. Sending the first case to /learn is a
          dead end: the tab is empty by definition, because there is nothing
          to continue. It was unreachable until the reset left accounts
          holding no course. */}
      <Link
        href={state === 'none' || percent === null ? '/market' : '/learn'}
        className="mt-4 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
      >
        {t(state === 'none' ? 'ctaJoin' : percent === null ? 'ctaStart' : 'ctaLearn')}
      </Link>
    </section>
  )
}
