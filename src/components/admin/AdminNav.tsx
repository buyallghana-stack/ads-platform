'use client'

import { useState } from 'react'

import type { LucideIcon } from 'lucide-react'
import {
  BadgeCheck,
  Building2,
  ClipboardList,
  Flag,
  Gauge,
  LayoutGrid,
  Menu,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Logo } from '@/components/brand/Logo'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Admin navigation.
 *
 * Three presentations of one list, following the two references:
 *
 *   xl and up   full sidebar with grouped sections and counts (reference 1)
 *   md–lg       icon rail, labels on hover (reference 2's left rail)
 *   below md    a drawer behind a menu button
 *
 * Inverted from the user app on purpose. The user app is thumb-first because
 * it is used on a phone between other things; admin work is a laptop job —
 * tables, filters, several things open at once — so the desktop layout is the
 * one designed first and the phone gets the honest subset.
 *
 * The groups are the operator's map of the product: MONEY is what they do
 * daily, PEOPLE is who it happens to, CONTENT is what feeds it, SYSTEM is the
 * machinery underneath. Anything they can point at and say "build that next"
 * has to be visible from the first screen.
 */

export type NavCounts = Partial<Record<string, number>>

type NavItem = { key: string; href: string; Icon: LucideIcon; exact?: boolean }
type NavGroup = { key: string; items: NavItem[] }

/* Typed rather than `as const`: the items are not the same shape (only
   Overview needs `exact`), and a const-asserted heterogeneous array makes
   every later `.flatMap` unusable. */
const GROUPS: NavGroup[] = [
  {
    key: 'money',
    items: [
      { key: 'overview', href: '/admin', Icon: Gauge, exact: true },
      { key: 'payouts', href: '/admin/payouts', Icon: Wallet },
      { key: 'finance', href: '/admin/finance', Icon: BadgeCheck },
      { key: 'advertisers', href: '/admin/advertisers', Icon: Building2 },
      { key: 'subscriptions', href: '/admin/subscriptions', Icon: ClipboardList },
    ],
  },
  {
    key: 'people',
    items: [
      { key: 'users', href: '/admin/users', Icon: Users },
      { key: 'messages', href: '/admin/messages', Icon: MessageSquare },
      { key: 'flagged', href: '/admin/flagged', Icon: Flag },
    ],
  },
  {
    key: 'content',
    items: [{ key: 'ads', href: '/admin/ads', Icon: LayoutGrid }],
  },
  {
    key: 'system',
    items: [
      { key: 'config', href: '/admin/config', Icon: ShieldAlert },
      { key: 'audit', href: '/admin/audit', Icon: ScrollText },
      { key: 'settings', href: '/admin/settings', Icon: Settings },
    ],
  },
]

function useIsActive() {
  const pathname = usePathname()
  return (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
}

function itemClasses(active: boolean) {
  return cn(
    'flex items-center gap-2.5 rounded-(--radius-input) px-2.5 py-2 text-[0.8125rem] font-medium',
    'transition-colors',
    active
      ? 'bg-brand-50 text-brand-700'
      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  )
}

/** Shared list body, used by both the sidebar and the drawer. */
function NavList({ counts, onNavigate }: { counts: NavCounts; onNavigate?: () => void }) {
  const t = useTranslations('admin.nav')
  const isActive = useIsActive()

  return (
    <nav aria-label={t('label')} className="flex flex-col gap-5">
      {GROUPS.map((group) => (
        <div key={group.key}>
          <p className="mb-1.5 px-2.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
            {t(`groups.${group.key}`)}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href, item.exact)
              const count = counts[item.key]
              return (
                <li key={item.key}>
                  <Link href={item.href} onClick={onNavigate} className={itemClasses(active)}>
                    <item.Icon
                      aria-hidden
                      className={cn('size-4 shrink-0', active ? 'text-brand-600' : 'text-ink-400')}
                      strokeWidth={active ? 2.3 : 2}
                    />
                    <span className="min-w-0 flex-1 truncate">{t(`items.${item.key}`)}</span>
                    {count ? (
                      /* Counts are work waiting, so they read as a queue depth
                         rather than decoration — the reference puts them in
                         the same place for the same reason. */
                      <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-ink-600 tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** xl+ : the full sidebar. */
export function AdminSidebar({ counts, admin }: { counts: NavCounts; admin: AdminChip }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200 bg-surface xl:flex">
      <div className="flex h-14 items-center border-b border-ink-200 px-4">
        <Logo variant="dark" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <NavList counts={counts} />
      </div>
      <AdminIdentity admin={admin} />
    </aside>
  )
}

/** md–lg : icon rail, following reference 2. */
export function AdminRail({ counts }: { counts: NavCounts }) {
  const t = useTranslations('admin.nav')
  const isActive = useIsActive()

  return (
    <aside className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-ink-200 bg-surface py-3 md:flex xl:hidden">
      <div className="mb-2">
        <Logo variant="dark" showWordmark={false} />
      </div>
      {GROUPS.flatMap((g) => g.items).map((item) => {
        const active = isActive(item.href, item.exact)
        const count = counts[item.key]
        return (
          <Link
            key={item.key}
            href={item.href}
            title={t(`items.${item.key}`)}
            aria-label={t(`items.${item.key}`)}
            className={cn(
              'relative grid size-9 place-items-center rounded-(--radius-input) transition-colors',
              active ? 'bg-brand-50 text-brand-600' : 'text-ink-400 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            <item.Icon aria-hidden className="size-4.5" strokeWidth={active ? 2.3 : 2} />
            {count ? (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-1.5 rounded-full bg-brand-600 ring-2 ring-surface"
              />
            ) : null}
          </Link>
        )
      })}
    </aside>
  )
}

export type AdminChip = { name: string; email: string }

function AdminIdentity({ admin }: { admin: AdminChip }) {
  const t = useTranslations('admin.nav')
  return (
    <div className="border-t border-ink-200 p-3">
      <div className="flex items-center gap-2.5 rounded-(--radius-input) px-2 py-1.5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-(--color-brand-accent) text-[0.75rem] font-bold text-white"
        >
          {admin.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold text-ink-900">{admin.name}</p>
          <p className="truncate text-[0.6875rem] text-ink-400">{t('roleAdmin')}</p>
        </div>
      </div>
    </div>
  )
}

/** below md : a drawer. Admin work on a phone is checking and approving, not
 *  browsing, so navigation gets out of the way until it is asked for. */
export function AdminDrawer({ counts, admin }: { counts: NavCounts; admin: AdminChip }) {
  const t = useTranslations('admin.nav')
  const [open, setOpen] = useState(false)

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('open')}
        className="grid size-9 place-items-center rounded-(--radius-input) text-ink-600 transition-colors hover:bg-ink-100 pointer-coarse:size-10"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-900/40"
          />
          <div className="relative flex h-full w-[17rem] flex-col bg-surface shadow-[8px_0_32px_-12px_rgb(15_23_42/0.35)]">
            <div className="flex h-14 items-center justify-between border-b border-ink-200 px-4">
              <Logo variant="dark" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('close')}
                className="grid size-9 place-items-center rounded-full text-ink-500 hover:bg-ink-100"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <NavList counts={counts} onNavigate={() => setOpen(false)} />
            </div>
            <AdminIdentity admin={admin} />
          </div>
        </div>
      )}
    </div>
  )
}
