'use client'

import { useMemo, useState } from 'react'

import { Flag, Mail, MessageSquare, Phone, Search, ShieldOff, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { Person } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusPill } from './AdminChrome'

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

export function PeopleGrid({
  people,
  mode,
  serverNow,
  onOpen,
}: {
  people: Person[]
  mode: PeopleMode
  /** The server's clock at render, so "joined this week" is decided once and
   *  the same on both sides of hydration. */
  serverNow: number
  /** Selecting a person. On Messages this is what opens the chat pane. */
  onOpen?: (person: Person) => void
}) {
  const t = useTranslations('admin.people')
  const format = useFormatter()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'new' | 'flagged' | 'unread'>('all')

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
    return people
      .filter((p) => {
        if (tab === 'new') return isNew(p)
        if (tab === 'flagged') return p.status === 'flagged' || p.status === 'disabled'
        if (tab === 'unread') return (p.unread ?? 0) > 0
        return true
      })
      .filter((p) => !q || [p.name, p.email, p.phone ?? ''].join(' ').toLowerCase().includes(q))
  }, [people, tab, query, serverNow])

  return (
    <div>
      {/* ---- Tabs with counts + search (reference 2) ------------------ */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ink-200">
        <div className="flex gap-5" role="tablist" aria-label={t('tabsLabel')}>
          {tabs.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'relative -mb-px border-b-2 px-0.5 pb-2.5 text-[0.8125rem] font-medium transition-colors',
                tab === key
                  ? 'border-brand-600 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-700',
              )}
            >
              {t(`tabs.${key}`)}{' '}
              <span className="ml-0.5 text-ink-400 tabular-nums">{counted[key]}</span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto mb-2.5 w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="h-9 w-full rounded-(--radius-input) border border-ink-200 bg-surface pl-9 pr-3 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-12 text-center text-[0.8125rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onOpen?.(p)}
                className={cn(
                  'flex h-full w-full flex-col rounded-(--radius-card) border border-ink-200 bg-surface p-3.5 text-left',
                  'shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-[border-color,box-shadow]',
                  'hover:border-ink-300 hover:shadow-[0_2px_10px_-2px_rgb(15_23_42/0.12)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <PersonCell name={p.name} secondary={p.email} avatarUrl={p.avatarUrl} size="md" />
                  {p.status !== 'active' && (
                    <StatusPill tone={p.status === 'disabled' ? 'danger' : 'warning'}>
                      {p.status === 'disabled' ? (
                        <ShieldOff aria-hidden className="size-3" />
                      ) : (
                        <Flag aria-hidden className="size-3" />
                      )}
                      {t(`status.${p.status}`)}
                    </StatusPill>
                  )}
                  {p.status === 'active' && (p.unread ?? 0) > 0 && mode === 'messages' && (
                    <StatusPill tone="brand">{p.unread}</StatusPill>
                  )}
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
                  <span className="shrink-0 font-medium text-brand-700">{t('open')} ›</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The panel that opens when a message thread is selected.
 *
 * A shell only: the operator is supplying the chatbot later, so this holds its
 * place, shows who the conversation is with, and says plainly that replying is
 * not wired yet. It does not render a fake transcript — an operator reading
 * invented messages from a real-looking user is worse than an empty panel.
 */
export function ConversationPanel({
  person,
  serverNow,
  onClose,
}: {
  person: Person
  serverNow: number
  onClose: () => void
}) {
  const t = useTranslations('admin.people')
  const format = useFormatter()

  return (
    <aside className="flex h-full flex-col rounded-(--radius-card) border border-ink-200 bg-surface shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="flex items-center gap-3 border-b border-ink-200 px-4 py-3">
        <PersonCell name={person.name} secondary={person.email} avatarUrl={person.avatarUrl} />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeThread')}
          className="ml-auto grid size-8 shrink-0 place-items-center rounded-full text-ink-500 hover:bg-ink-100"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <div className="flex min-h-[14rem] flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
          <MessageSquare aria-hidden className="size-5" />
        </span>
        <p className="text-[0.875rem] font-semibold text-ink-900">{t('chatSoonTitle')}</p>
        <p className="max-w-[34ch] text-[0.75rem] leading-relaxed text-ink-500">
          {t('chatSoonBody')}
        </p>
        {person.lastMessageAt && (
          <p className="mt-1 text-[0.6875rem] text-ink-400">
            {t('lastHeard', { when: format.relativeTime(new Date(person.lastMessageAt), serverNow) })}
          </p>
        )}
      </div>
    </aside>
  )
}
