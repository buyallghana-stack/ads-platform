import type { Metadata } from 'next'

import {
  ChevronRight,
  FileText,
  Gem,
  KeyRound,
  Languages,
  ListChecks,
  Lock,
  Mail,
  MonitorSmartphone,
  Palette,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LogOutButton } from '@/components/app/LogOutButton'
import { LanguageToggle } from '@/components/profile/LanguageToggle'
import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Badge } from '@/components/ui/Badge'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getSessionUser } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Profile',
  robots: { index: false, follow: false },
}

/** Two-letter initials from the full name, for the avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Profile tab — the account & settings hub, built to the operator's mobile
 * reference (2026-07-24): a profile card, an upgrade promo, then grouped
 * setting rows. Tablet/desktop reuse the same single centred column, which is
 * how settings screens read best at any width.
 *
 * Working now: appearance (theme), language, log out. The account and security
 * rows are DESIGNED destinations whose flows and secure backends land as
 * focused follow-ups (payout accounts, PIN, password/email change, two-factor
 * via an authenticator app, account deletion) — each tagged so it is honest
 * about not being wired yet.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('profile')
  const profile = await getProfile(user!.id)
  const fullName = profile?.full_name ?? user!.email ?? ''
  const soon = t('soon')

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 md:py-7">
      <header className="animate-rise">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* Profile card ---------------------------------------------------- */}
      <div
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise flex items-center gap-3.5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-(--color-brand-accent) text-[0.9375rem] font-bold text-white">
          {initials(fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-ink-900">
            {profile?.full_name ?? t('noName')}
          </p>
          <p className="truncate text-[0.8125rem] text-ink-500">{user!.email}</p>
        </div>
      </div>

      {/* Upgrade promo --------------------------------------------------- */}
      <Link
        href="/upgrade"
        style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
        className="animate-rise flex items-center gap-3.5 rounded-(--radius-card) border border-violet-600/20 bg-violet-50 p-4 transition-colors hover:border-violet-600/45"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-600/10 text-violet-600">
          <Gem aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.875rem] font-semibold text-violet-700">{t('upgrade.title')}</p>
          <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">{t('upgrade.body')}</p>
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-violet-600/60" />
      </Link>

      <div
        style={{ '--rise-delay': '0.15s' } as React.CSSProperties}
        className="animate-rise flex flex-col gap-5"
      >
        {/* Account ------------------------------------------------------- */}
        <SettingsGroup title={t('groups.account')}>
          <SettingsRow icon={<UserRound />} tone="brand" label={t('account.personal')} description={t('account.personalHint')} soon={soon} />
          <SettingsRow href="/profile/payout" icon={<Wallet />} tone="teal" label={t('account.payout')} description={t('account.payoutHint')} />
          <SettingsRow href="/profile/pin" icon={<KeyRound />} tone="orange" label={t('account.pin')} description={t('account.pinHint')} />
        </SettingsGroup>

        {/* Security ------------------------------------------------------ */}
        <SettingsGroup title={t('groups.security')}>
          <SettingsRow icon={<ShieldCheck />} tone="success" label={t('security.twoFactor')} description={t('security.twoFactorHint')} soon={soon} />
          <SettingsRow icon={<ListChecks />} tone="success" label={t('security.backupCodes')} description={t('security.backupCodesHint')} soon={soon} />
          <SettingsRow icon={<Lock />} tone="brand" label={t('security.password')} soon={soon} />
          <SettingsRow icon={<Mail />} tone="brand" label={t('security.email')} value={user!.email} soon={soon} showChevron={false} />
          <SettingsRow icon={<MonitorSmartphone />} tone="neutral" label={t('security.sessions')} description={t('security.sessionsHint')} soon={soon} />
        </SettingsGroup>

        {/* Preferences (working) ---------------------------------------- */}
        <SettingsGroup title={t('groups.preferences')}>
          <SettingsRow
            icon={<Palette />}
            tone="violet"
            label={t('preferences.appearance')}
            trailing={<ThemeToggle />}
          />
          <SettingsRow
            icon={<Languages />}
            tone="brand"
            label={t('preferences.language')}
            trailing={<LanguageToggle />}
          />
        </SettingsGroup>

        {/* Support ------------------------------------------------------- */}
        <SettingsGroup title={t('groups.support')}>
          <SettingsRow icon={<ScrollText />} tone="neutral" label={t('support.help')} soon={soon} />
          <SettingsRow href="/privacy" icon={<FileText />} tone="neutral" label={t('support.privacy')} />
          <SettingsRow href="/terms" icon={<FileText />} tone="neutral" label={t('support.terms')} />
        </SettingsGroup>

        {/* Danger + logout ---------------------------------------------- */}
        <SettingsGroup>
          <SettingsRow icon={<Trash2 />} danger label={t('danger.delete')} description={t('danger.deleteHint')} soon={soon} />
          <LogOutButton row />
        </SettingsGroup>

        <p className="pb-2 text-center text-[0.6875rem] text-ink-400">
          {t('version', { version: '0.1.0' })}
        </p>
      </div>
    </div>
  )
}
