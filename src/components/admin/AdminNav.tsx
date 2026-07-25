'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  SquareArrowOutUpRight,
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

/**
 * `touch` is the drawer's variant. A 32px row is fine under a mouse and a
 * poor thumb target, and the drawer is the only presentation that is always
 * driven by a thumb — the sidebar and the rail are laptop furniture. So the
 * rows grow to 44px there rather than everywhere, which would make the
 * desktop sidebar a third taller for no reason.
 */
function itemClasses(active: boolean, touch?: boolean) {
  return cn(
    'flex items-center gap-3 rounded-(--radius-input) font-medium transition-colors',
    touch ? 'min-h-11 px-3 py-2.5 text-[0.9375rem]' : 'gap-2.5 px-2.5 py-2 text-[0.8125rem]',
    active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  )
}

/** Shared list body, used by both the sidebar and the drawer. */
function NavList({
  counts,
  onNavigate,
  touch,
}: {
  counts: NavCounts
  onNavigate?: () => void
  /** Thumb-sized rows and headings. See itemClasses. */
  touch?: boolean
}) {
  const t = useTranslations('admin.nav')
  const isActive = useIsActive()

  return (
    <nav aria-label={t('label')} className={cn('flex flex-col', touch ? 'gap-4' : 'gap-5')}>
      {GROUPS.map((group) => (
        <div key={group.key}>
          <p
            className={cn(
              'font-semibold tracking-[0.08em] text-ink-400 uppercase',
              touch ? 'mb-1 px-3 text-[0.625rem]' : 'mb-1.5 px-2.5 text-[0.6875rem]',
            )}
          >
            {t(`groups.${group.key}`)}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href, item.exact)
              const count = counts[item.key]
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={itemClasses(active, touch)}
                  >
                    <item.Icon
                      aria-hidden
                      className={cn(
                        'shrink-0',
                        touch ? 'size-5' : 'size-4',
                        active ? 'text-brand-600' : 'text-ink-400',
                      )}
                      strokeWidth={active ? 2.3 : 2}
                    />
                    <span className="min-w-0 flex-1 truncate">{t(`items.${item.key}`)}</span>
                    {count ? (
                      /* Counts are work waiting, so they read as a queue depth
                         rather than decoration. In the drawer they are the
                         reason somebody opened it, so they carry the brand
                         fill rather than a grey chip. */
                      <span
                        className={cn(
                          'shrink-0 rounded-full font-semibold tabular-nums',
                          touch
                            ? 'bg-brand-600 px-2 py-0.5 text-[0.75rem] text-white'
                            : 'bg-ink-100 px-1.5 py-0.5 text-[0.6875rem] text-ink-600',
                        )}
                      >
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

function AdminIdentity({ admin, onNavigate }: { admin: AdminChip; onNavigate?: () => void }) {
  const t = useTranslations('admin.nav')
  return (
    <div className="shrink-0 border-t border-ink-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* The operator uses one account for both, and checks the user
          experience from it. A dashboard with no way out is a trap. */}
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="mb-1 flex min-h-10 items-center gap-2.5 rounded-(--radius-input) px-2.5 py-2 text-[0.8125rem] font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <SquareArrowOutUpRight aria-hidden className="size-4 shrink-0 text-ink-400" />
        {t('viewUserApp')}
      </Link>
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

/**
 * below md : a drawer. Admin work on a phone is checking and approving, not
 * browsing, so navigation gets out of the way until it is asked for.
 *
 * PORTALLED TO <body>, AND THAT IS NOT OPTIONAL.
 * This button lives inside the top bar, and the top bar has `backdrop-blur`.
 * A backdrop-filter creates a containing block for fixed-position
 * descendants, so `fixed inset-0` resolved against the 56px-tall header
 * rather than the viewport: the panel was 56px high, its scrolling nav area
 * collapsed to nothing, and only the group heading and the identity block
 * rendered — over the page, because they overflowed. Every tab below MONEY
 * was unreachable. Portalling moves the panel out from under the filter, and
 * is the same fix MoreMenu already uses for the same reason.
 */
export function AdminDrawer({ counts, admin }: { counts: NavCounts; admin: AdminChip }) {
  const t = useTranslations('admin.nav')
  const [open, setOpen] = useState(false)
  const [moreBelow, setMoreBelow] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  /*
    Twelve tabs do not fit a 640px phone, so the list scrolls — and on that
    screen it happened to cut exactly at the CONTENT heading, which read as
    "this group is empty" rather than "there is more below". That is the
    complaint this whole drawer was reported for, so the cue is measured
    rather than assumed: a fade appears only while something is genuinely
    out of view, and goes when the list is scrolled to the end.
  */
  const measure = () => {
    const el = scrollRef.current
    if (!el) return
    setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }

  /* Escape closes, the page behind stops scrolling, focus moves into the
     panel and comes back to the button afterwards. All four are noticed only
     when missing. */
  useEffect(() => {
    if (!open) return
    // Captured now: by cleanup time the ref may point elsewhere, and this is
    // the node focus has to return to.
    const trigger = triggerRef.current
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    measure()
    /* Rotating a phone to landscape is 844×390 — past `md`, where the drawer
       is hidden by CSS and the rail takes over. Without this the panel would
       vanish while the scroll lock stayed on, leaving the page frozen. */
    const onResize = () => {
      if (window.matchMedia('(min-width: 48rem)').matches) setOpen(false)
      else measure()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      trigger?.focus()
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('open')}
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-(--radius-input) text-ink-600 transition-colors hover:bg-ink-100 pointer-coarse:size-10"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              aria-label={t('close')}
              onClick={() => setOpen(false)}
              className="absolute inset-0 animate-[scrim-in_150ms_ease-out] bg-ink-900/50"
            />

            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('label')}
              tabIndex={-1}
              className={cn(
                'relative flex w-[min(20rem,86vw)] flex-col bg-surface focus:outline-none',
                /* dvh, not vh or h-full: on a phone the browser chrome
                   shrinks the viewport as you scroll, and vh keeps the old
                   number — which puts the identity block underneath the
                   address bar exactly when somebody reaches for it. */
                'h-dvh',
                'animate-[drawer-in_220ms_cubic-bezier(0.22,1,0.36,1)]',
                'shadow-[8px_0_32px_-12px_rgb(15_23_42/0.35)]',
              )}
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink-200 px-4">
                <Logo variant="dark" />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('close')}
                  className="-mr-1 grid size-10 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>

              {/* The only scrolling region. It has to be the flex child that
                  grows, or the twelve tabs push the identity block off the
                  bottom instead of scrolling under it. */}
              <div className="relative min-h-0 flex-1">
                <div
                  ref={scrollRef}
                  onScroll={measure}
                  className="h-full overflow-y-auto overscroll-contain px-3 py-3"
                >
                  <NavList counts={counts} touch onNavigate={() => setOpen(false)} />
                </div>
                {moreBelow && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-(--color-surface) to-transparent"
                  />
                )}
              </div>

              <AdminIdentity admin={admin} onNavigate={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
