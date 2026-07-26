'use client'

import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { ThemeSwitchButton } from '@/components/theme/ThemeSwitchButton'
import { usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

import { AdminDrawer, type AdminChip, type NavCounts } from './AdminNav'

/**
 * The bar across the top of every admin screen (reference 1).
 *
 * Carries the menu button on a phone, a search field, the theme switch, and
 * the data badge. That badge is not decoration: most figures in this
 * dashboard are still invented while the backends are wired, and these are
 * money numbers. An operator must never be one glance away from treating an
 * imagined revenue figure as real, so it sits in the chrome of every screen
 * rather than on a page somebody might scroll past.
 *
 * As screens become real the badge has to say so, or "no badge" would mean
 * both "this is live" and "somebody forgot the badge". So a wired screen
 * shows a LIVE badge instead of losing one — REAL_ADMIN_SECTIONS is the whole
 * switch, one line per screen as each is finished.
 */
const REAL_ADMIN_SECTIONS = ['/admin/ads']

export function AdminTopBar({
  counts,
  admin,
  preview,
}: {
  counts: NavCounts
  admin: AdminChip
  preview: boolean
}) {
  const t = useTranslations('admin')
  const pathname = usePathname()
  const live = REAL_ADMIN_SECTIONS.some((section) => pathname.startsWith(section))

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-ink-200 bg-surface/95 px-3 backdrop-blur sm:px-5">
      <AdminDrawer counts={counts} admin={admin} />

      {/* Search is the reference's anchor for the bar. It is inert until the
          screens behind it exist — labelled, not faked with a fake result. */}
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400"
        />
        <input
          type="search"
          disabled
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className={cn(
            'h-9 w-full rounded-(--radius-input) border border-ink-200 bg-canvas pl-9 pr-3',
            'text-[0.8125rem] text-ink-900 placeholder:text-ink-400 pointer-coarse:text-base',
            'disabled:cursor-not-allowed disabled:opacity-70',
          )}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {live ? (
          <span className="hidden items-center gap-1.5 rounded-full border border-success-500/25 bg-success-50 px-2.5 py-1 text-[0.6875rem] font-semibold text-success-700 sm:inline-flex">
            <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
            {t('liveBadge')}
          </span>
        ) : (
          preview && (
            <span className="hidden items-center gap-1.5 rounded-full border border-warning-500/30 bg-warning-50 px-2.5 py-1 text-[0.6875rem] font-semibold text-warning-600 sm:inline-flex">
              <span aria-hidden className="size-1.5 rounded-full bg-warning-500" />
              {t('previewBadge')}
            </span>
          )
        )}
        <ThemeSwitchButton />
      </div>
    </header>
  )
}

/**
 * Page heading. One shape for every screen so the eye lands in the same place
 * on each — the reference's "Overview for today" block, with the actions
 * pinned right and wrapping under the title on a phone.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.5rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-[62ch] text-[0.8125rem] leading-relaxed text-ink-500">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

/** Status pill, the reference's language for state in a table row. */
type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'violet'

const PILL: Record<PillTone, string> = {
  neutral: 'border-ink-200 bg-ink-50 text-ink-600',
  success: 'border-success-500/25 bg-success-50 text-success-700',
  warning: 'border-warning-500/30 bg-warning-50 text-warning-600',
  danger: 'border-danger-500/25 bg-danger-50 text-danger-700',
  brand: 'border-brand-600/20 bg-brand-50 text-brand-700',
  violet: 'border-violet-600/20 bg-violet-50 text-violet-700',
}

export function StatusPill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-[0.6875rem] font-semibold whitespace-nowrap',
        PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Status as a dot plus plain text, for dense tables.
 *
 * Same tone vocabulary as StatusPill — the operator learns one set of
 * colours — but without the border and tint, because eight tinted capsules
 * stacked down a column compete with the money for attention and the money
 * should win. The pill stays for places where a status sits alone and needs
 * to hold its own; the dot is for a row that already has six other things
 * in it. Colour is never the only carrier: the label is always there.
 */
const DOT: Record<PillTone, string> = {
  neutral: 'bg-ink-400',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  brand: 'bg-brand-600',
  violet: 'bg-violet-600',
}

export function StatusDot({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[0.75rem] font-medium whitespace-nowrap text-ink-700',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  )
}

/**
 * Identity cell: avatar, name, secondary line. Used by the table rows and the
 * people cards alike (both references show the same two-line person block),
 * so the two views of a person never drift apart.
 */
export function PersonCell({
  name,
  secondary,
  avatarUrl,
  size = 'sm',
}: {
  name: string
  secondary?: string
  avatarUrl?: string | null
  size?: 'sm' | 'md'
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className={cn(
            'shrink-0 rounded-full bg-ink-100 object-cover',
            size === 'md' ? 'size-10' : 'size-8',
          )}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            'grid shrink-0 place-items-center rounded-full font-semibold text-white',
            'bg-gradient-to-br from-brand-600 to-(--color-brand-accent)',
            size === 'md' ? 'size-10 text-[0.8125rem]' : 'size-8 text-[0.6875rem]',
          )}
        >
          {initials || '·'}
        </span>
      )}
      <div className="min-w-0">
        <p
          className={cn(
            'truncate font-medium text-ink-900',
            size === 'md' ? 'text-[0.875rem]' : 'text-[0.8125rem]',
          )}
        >
          {name}
        </p>
        {secondary && <p className="truncate text-[0.6875rem] text-ink-400">{secondary}</p>}
      </div>
    </div>
  )
}
