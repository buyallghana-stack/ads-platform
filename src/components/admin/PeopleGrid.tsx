'use client'

import { useMemo, useState } from 'react'

import { Flag, Mail, MessageSquare, PanelRight, Phone, ShieldCheck, ShieldOff } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { Person } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import { EmptyState, FilterBar, FilterSelect, RowOpener, Toolbar, type Tab } from './AdminTable'
import { PERSON_RULES, personActions, type PersonAction } from './person-actions'

/**
 * The stacked card layout from reference 2, and the operator's own plan for
 * it: one component behind Users, Flagged accounts and Messages.
 *
 * That reuse is the point rather than a saving. A person is the same person
 * whether you reached them from the user list, from a fraud flag or from a
 * message they sent, so the card shows the same face, the same name and the
 * same state in all three places. Three bespoke lists would drift, and an
 * operator would have to learn three ways to read the same fact.
 *
 * What changes per tab is the SECONDARY line and the action, because that is
 * what the operator came for:
 *   users     balance and plan, opening the profile
 *   flagged   why it was flagged and by whom, opening the review
 *   messages  the last message, opening the conversation
 *
 * Four across on a wide screen (the reference), down to one on a phone.
 */

export type PeopleMode = 'users' | 'flagged' | 'messages'

/* `attention` is the order the server already sends (disabled, then flagged,
   then newest), so it costs nothing and stays the default. */
const SORTS = [
  'attention',
  'newest',
  'oldest',
  'lastActive',
  'balance',
  'lifetime',
  'ads',
  'referrals',
  'paidOut',
  'name',
] as const
type Sort = (typeof SORTS)[number]

const ACTIVITY = ['any', 'day', 'week', 'idle30'] as const
type Activity = (typeof ACTIVITY)[number]

const DAY = 86_400_000

/** Largest first for every figure, because "who has the most" is the
 *  question; oldest-first is its own option rather than a direction toggle. */
const COMPARE: Record<Exclude<Sort, 'attention'>, (a: Person, b: Person) => number> = {
  newest: (a, b) => b.joinedAt.localeCompare(a.joinedAt),
  oldest: (a, b) => a.joinedAt.localeCompare(b.joinedAt),
  lastActive: (a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt),
  balance: (a, b) => b.balancePoints - a.balancePoints,
  lifetime: (a, b) => b.lifetimePoints - a.lifetimePoints,
  ads: (a, b) => b.adsWatched - a.adsWatched,
  referrals: (a, b) => b.referrals - a.referrals,
  paidOut: (a, b) => b.paidOutGhs - a.paidOutGhs,
  name: (a, b) => a.name.localeCompare(b.name),
}

export function PeopleGrid({
  people,
  mode,
  serverNow,
  onOpen,
  onDecide,
  openId,
}: {
  people: Person[]
  mode: PeopleMode
  /** The server's clock at render, so "joined this week" is decided once and
   *  the same on both sides of hydration. */
  serverNow: number
  /** Opening a person's review panel. */
  onOpen: (person: Person) => void
  /** Firing an action straight from the card's overflow menu. */
  onDecide: (id: string, action: PersonAction, reason: string) => void
  /** Highlights the row whose panel is open. */
  openId?: string | null
}) {
  const t = useTranslations('admin.people')
  const format = useFormatter()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'new' | 'flagged' | 'unread'>('all')

  /* Messages is a conversation list and keeps the server's "whoever spoke
     last" order; plan and activity cuts are for the account screens. */
  const filterable = mode !== 'messages'
  const [plan, setPlan] = useState('any')
  const [activity, setActivity] = useState<Activity>('any')
  const [sort, setSort] = useState<Sort>('attention')

  /* The plans actually present, so the list never offers a plan with no one
     on it and picks up a new rung without a code change. */
  const plans = useMemo(
    () => [...new Set(people.map((p) => p.tier))].sort((a, b) => a.localeCompare(b)),
    [people],
  )

  const tabs = useMemo(() => {
    if (mode === 'messages') return ['all', 'unread'] as const
    if (mode === 'flagged') return ['all', 'flagged'] as const
    return ['all', 'new', 'flagged'] as const
  }, [mode])

  const counted = useMemo(() => {
    const isNew = (p: Person) => serverNow - new Date(p.joinedAt).getTime() < 7 * 86_400_000
    return {
      all: people.length,
      new: people.filter(isNew).length,
      flagged: people.filter((p) => p.status === 'flagged' || p.status === 'disabled').length,
      unread: people.filter((p) => (p.unread ?? 0) > 0).length,
    }
  }, [people, serverNow])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const isNew = (p: Person) => serverNow - new Date(p.joinedAt).getTime() < 7 * 86_400_000
    const base = people
      .filter((p) => {
        if (tab === 'new') return isNew(p)
        if (tab === 'flagged') return p.status === 'flagged' || p.status === 'disabled'
        if (tab === 'unread') return (p.unread ?? 0) > 0
        return true
      })
      .filter((p) => !q || [p.name, p.email, p.phone ?? ''].join(' ').toLowerCase().includes(q))

    if (!filterable) return base

    const idle = (p: Person) => serverNow - new Date(p.lastActiveAt).getTime()
    const cut = base
      .filter((p) => plan === 'any' || p.tier === plan)
      .filter((p) => {
        if (activity === 'day') return idle(p) < DAY
        if (activity === 'week') return idle(p) < 7 * DAY
        if (activity === 'idle30') return idle(p) >= 30 * DAY
        return true
      })
    return sort === 'attention' ? cut : [...cut].sort(COMPARE[sort])
  }, [people, tab, query, serverNow, filterable, plan, activity, sort])

  const narrowed = plan !== 'any' || activity !== 'any' || sort !== 'attention'
  const resetFilters = () => {
    setPlan('any')
    setActivity('any')
    setSort('attention')
  }

  /** The card's menu: review first, then the decisions, destructive last. */
  const menuFor = (p: Person): MenuItem[] => {
    const items: MenuItem[] = [
      {
        key: 'open',
        label: t('actions.review'),
        icon: <PanelRight />,
        onSelect: () => onOpen(p),
      },
    ]
    personActions(p).forEach((a, i) => {
      const rule = PERSON_RULES[a]
      items.push({
        key: a,
        label: t(`actions.${a}`),
        icon:
          a === 'flag' ? <Flag /> : a === 'disable' ? <ShieldOff /> : <ShieldCheck />,
        tone: rule.destructive ? 'danger' : 'default',
        separated: i === 0 || rule.destructive,
        /* Anything needing a reason opens the panel instead of firing here.
           A flag with no reason is an account somebody re-investigates from
           scratch, and a menu item is one mis-aim away from the row above. */
        hint: rule.confirm || rule.reason ? t('actions.opensPanel') : undefined,
        onSelect: () => (rule.confirm || rule.reason ? onOpen(p) : onDecide(p.id, a, '')),
      })
    })
    return items
  }

  const tabList: Tab<(typeof tabs)[number]>[] = tabs.map((key) => ({
    key,
    label: t(`tabs.${key}`),
    count: counted[key],
  }))

  return (
    <div>
      <Toolbar
        tabs={tabList}
        active={tab}
        onSelect={setTab}
        tabsLabel={t('tabsLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('searchPlaceholder')}
      />

      {filterable && (
        <FilterBar
          summary={
            narrowed
              ? t('filters.showing', {
                  shown: visible.length,
                  total: people.length,
                })
              : undefined
          }
          onReset={narrowed ? resetFilters : undefined}
          resetLabel={t('filters.reset')}
        >
          <FilterSelect
            label={t('filters.plan')}
            value={plan}
            onChange={setPlan}
            options={[
              { key: 'any', label: t('filters.anyPlan') },
              ...plans.map((name) => ({ key: name, label: name })),
            ]}
          />
          <FilterSelect
            label={t('filters.activity')}
            value={activity}
            onChange={setActivity}
            options={ACTIVITY.map((key) => ({
              key,
              label: t(`filters.activityOptions.${key}`),
            }))}
          />
          <FilterSelect
            label={t('filters.sort')}
            value={sort}
            onChange={setSort}
            options={SORTS.map((key) => ({
              key,
              label: t(`filters.sortOptions.${key}`),
            }))}
          />
        </FilterBar>
      )}

      {visible.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((p) => (
            <li
              key={p.id}
              className={cn(
                'relative flex h-full flex-col rounded-(--radius-card) border bg-surface p-3.5',
                'transition-colors',
                openId === p.id
                  ? 'border-brand-600 bg-brand-50/40'
                  : 'border-ink-200 hover:border-ink-300',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <RowOpener rounded label={t('reviewRow', { name: p.name })} onClick={() => onOpen(p)}>
                  <PersonCell name={p.name} secondary={p.email} size="md" />
                </RowOpener>
                {/* The card carries its own ⋯, exactly as the operator's
                    reference does. z-10 keeps it above the stretched opener. */}
                <span className="relative z-10 shrink-0">
                  <MoreMenu label={t('menuLabel', { name: p.name })} items={menuFor(p)} />
                </span>
              </div>

              {/* The line that differs per tab — what the operator opened
                  this list to find out. */}
              <div className="mt-3 min-h-[2.25rem] border-t border-ink-200 pt-2.5">
                {mode === 'messages' ? (
                  <p className="line-clamp-2 text-[0.75rem] leading-relaxed text-ink-600">
                    {p.lastMessage ?? t('noMessages')}
                  </p>
                ) : mode === 'flagged' ? (
                  <p className="line-clamp-2 text-[0.75rem] leading-relaxed text-ink-600">
                    <span className="font-medium text-ink-700">
                      {t(`flaggedBy.${p.flaggedBy ?? 'system'}`)}:
                    </span>{' '}
                    {p.flagReason ?? '—'}
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-2 text-[0.75rem]">
                    <span className="text-ink-500">{p.tier}</span>
                    <span className="font-semibold text-ink-900 tabular-nums">
                      {p.balancePoints.toLocaleString()} pts
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 text-[0.6875rem] text-ink-400">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {mode === 'messages' ? (
                    <>
                      <MessageSquare aria-hidden className="size-3" />
                      <span className="truncate">
                        {p.lastMessageAt
                          ? format.relativeTime(new Date(p.lastMessageAt), serverNow)
                          : t('noMessages')}
                      </span>
                    </>
                  ) : p.phone ? (
                    <>
                      <Phone aria-hidden className="size-3" />
                      <span className="truncate">{p.phone}</span>
                    </>
                  ) : (
                    <>
                      <Mail aria-hidden className="size-3" />
                      <span className="truncate">{p.email}</span>
                    </>
                  )}
                </span>

                {/* Status sits here rather than beside the name, so the ⋯ has
                    the top-right corner to itself and every card is the same
                    shape whether or not it is flagged. */}
                {p.status !== 'active' ? (
                  <StatusDot
                    tone={p.status === 'disabled' ? 'danger' : 'warning'}
                    className="shrink-0 text-[0.6875rem]"
                  >
                    {t(`status.${p.status}`)}
                  </StatusDot>
                ) : (p.unread ?? 0) > 0 && mode === 'messages' ? (
                  <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-px text-[0.625rem] font-semibold text-white tabular-nums">
                    {p.unread}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/*
  ConversationPanel used to live here — a separate pane, only on Messages,
  that no other tab could reach. It has been folded into PersonPanel as a
  section: the same account should not have two different panels depending on
  which list you found it in, and the operator asking "why is this person
  messaging me" almost always wants the balance and the flag in the same
  view as the message.
*/
