'use client'

import { useMemo, useState } from 'react'

import {
  AlertTriangle,
  Ban,
  Check,
  Flag,
  Pause,
  PlusCircle,
  Settings2,
  Wallet,
  X,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { AuditEntry } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { EmptyState, Toolbar, type Tab } from './AdminTable'

/**
 * The audit log — who changed what, when, and what it was before.
 *
 * A LIST, NOT A TABLE. Everything else in the admin area is a table because
 * the rows are comparable: eight payouts have the same six facts and the eye
 * scans down a column. Audit entries are not comparable — a config change has
 * a before and an after, a flag has a reason, an approval has neither — so a
 * table of them is mostly empty cells. A timeline reads in the direction the
 * events actually happened and lets each entry be exactly as long as it is.
 *
 * THE BEFORE/AFTER IS THE POINT. "Config changed" is not an audit trail;
 * "per_user_daily_points_cap 400 → 500" is. Entries that genuinely have no
 * before simply do not show one, rather than showing an em dash that looks
 * like data went missing.
 *
 * Newest first, and never paginated away from the operator: the entry they
 * want is nearly always one of the last few, because they are here to check
 * something they or the system just did.
 */

type Filter = 'all' | 'money' | 'accounts' | 'config' | 'system'

const FILTERS: Filter[] = ['all', 'money', 'accounts', 'config', 'system']

/** Which filter each action belongs to, and how it is drawn. */
const ACTIONS = {
  payout_approved: { group: 'money', tone: 'success', icon: <Check /> },
  payout_paid: { group: 'money', tone: 'success', icon: <Wallet /> },
  payout_declined: { group: 'money', tone: 'danger', icon: <X /> },
  account_flagged: { group: 'accounts', tone: 'warning', icon: <Flag /> },
  account_disabled: { group: 'accounts', tone: 'danger', icon: <Ban /> },
  config_changed: { group: 'config', tone: 'brand', icon: <Settings2 /> },
  ad_created: { group: 'config', tone: 'brand', icon: <PlusCircle /> },
  ad_paused: { group: 'config', tone: 'warning', icon: <Pause /> },
  alert_raised: { group: 'system', tone: 'warning', icon: <AlertTriangle /> },
} as const satisfies Record<
  AuditEntry['action'],
  { group: Exclude<Filter, 'all'>; tone: string; icon: React.ReactNode }
>

const TONE: Record<string, string> = {
  success: 'border-success-500/25 bg-success-50 text-success-700',
  warning: 'border-warning-500/30 bg-warning-50 text-warning-600',
  danger: 'border-danger-500/25 bg-danger-50 text-danger-700',
  brand: 'border-brand-600/20 bg-brand-50 text-brand-700',
}

export function AuditLog({ entries, serverNow }: { entries: AuditEntry[]; serverNow: number }) {
  const t = useTranslations('admin.audit')
  const format = useFormatter()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter((e) => filter === 'all' || ACTIONS[e.action].group === filter)
      .filter(
        (e) =>
          !q ||
          [e.actor, e.target, e.note ?? '', t(`actions.${e.action}`)]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
  }, [entries, filter, query, t])

  const tabs: Tab<Filter>[] = FILTERS.map((f) => ({
    key: f,
    label: t(`filters.${f}`),
    count:
      f === 'all' ? entries.length : entries.filter((e) => ACTIONS[e.action].group === f).length,
  }))

  return (
    <div>
      <Toolbar
        tabs={tabs}
        active={filter}
        onSelect={setFilter}
        tabsLabel={t('filterLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('searchPlaceholder')}
      />

      {visible.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ol className="relative">
          {/* The spine. Decorative, and behind the markers rather than
              between them, so entries of different heights stay connected. */}
          <span
            aria-hidden
            className="absolute top-3 bottom-3 left-[0.9375rem] w-px bg-ink-200"
          />

          {visible.map((e) => {
            const meta = ACTIONS[e.action]
            return (
              <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border',
                    '[&>svg]:size-3.5',
                    TONE[meta.tone],
                  )}
                >
                  {meta.icon}
                </span>

                <div className="min-w-0 flex-1 rounded-(--radius-card) border border-ink-200 bg-surface px-3.5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[0.8125rem] font-semibold text-ink-900">
                      {t(`actions.${e.action}`)}
                    </span>
                    <span className="text-[0.75rem] text-ink-500">{e.target}</span>
                  </div>

                  {/* The whole reason an audit log exists. */}
                  {e.before !== undefined && e.after !== undefined && (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[0.75rem]">
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-500 line-through">
                        {e.before}
                      </span>
                      <span aria-hidden className="text-ink-400">
                        →
                      </span>
                      <span className="rounded bg-success-50 px-1.5 py-0.5 font-semibold text-success-700">
                        {e.after}
                      </span>
                      {e.before === e.after && (
                        <span className="font-sans text-[0.6875rem] text-ink-400">
                          {t('unchanged')}
                        </span>
                      )}
                    </p>
                  )}

                  {e.note && (
                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-600">{e.note}</p>
                  )}

                  <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-ink-400">
                    <span className="font-medium text-ink-500">{e.actor}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={e.at}>
                      {format.relativeTime(new Date(e.at), serverNow)}
                    </time>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {format.dateTime(new Date(e.at), {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
