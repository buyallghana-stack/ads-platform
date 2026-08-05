import type { Metadata } from 'next'

import {
  ChevronRight,
  FileText,
  Gauge,
  Gem,
  KeyRound,
  Languages,
  ListChecks,
  Lock,
  Mail,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  Trash2,
  UserRound,
  Wallet,
  MessageCircle,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LogOutButton } from '@/components/app/LogOutButton'
import { Avatar } from '@/components/profile/Avatar'
import { LanguageToggle } from '@/components/profile/LanguageToggle'
import { DeletionPendingBanner } from '@/components/profile/DeletionPendingBanner'
import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Link, redirect } from '@/i18n/navigation'
import { getProfile, getViewerUser } from '@/lib/auth/session'
import { avatarPublicUrl } from '@/lib/profile/avatar'
import { getDeletionStatus } from '@/lib/security/deletion-data'
import { getTwoFactorStatus } from '@/lib/security/two-factor-data'
import { isAdminUser } from '@/lib/auth/landing'
import { getPlanStanding } from '@/lib/subscriptions/data'

export const metadata: Metadata = {
  title: 'Profile',
  robots: { index: false, follow: false },
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

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('profile')
  const profile = await getProfile(user!.id)
  const twoFactor = await getTwoFactorStatus()
  // Plans STACK, so "upgrade" is only the right word before you own one.
  const planStanding = await getPlanStanding(user!.id)
  const isAdmin = await isAdminUser(user!.id)
  const deletion = await getDeletionStatus()
  const fullName = profile?.full_name ?? user!.email ?? ''

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 md:py-7">
      <header className="animate-rise">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {deletion.pending && deletion.effectiveAt && (
        <DeletionPendingBanner
          effectiveAt={deletion.effectiveAt}
          daysLeft={deletion.daysLeft ?? 0}
        />
      )}

      {/* Profile card ---------------------------------------------------- */}
      <div
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise flex items-center gap-3.5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      >
        <Avatar
          name={fullName}
          src={avatarPublicUrl(profile?.avatar_path)}
          className="size-12 text-[0.9375rem]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-ink-900">
            {profile?.full_name ?? t('noName')}
          </p>
          <p className="truncate text-[0.8125rem] text-ink-500">{user!.email}</p>
        </div>
      </div>

      {/* Upgrade promo ----------------------------------------------------
          Hidden outright once every plan is held: there is nothing left to
          sell, and continuing to advertise at a customer who has bought the
          lot is the one version of this card that cannot be justified. */}
      {planStanding !== 'all' && (
        <Link
          href="/upgrade"
          style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
          className="animate-rise flex items-center gap-3.5 rounded-(--radius-card) border border-violet-600/20 bg-violet-50 p-4 transition-colors hover:border-violet-600/45"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-600/10 text-violet-600">
            <Gem aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] font-semibold text-violet-700">
              {t(planStanding === 'some' ? 'upgrade.addTitle' : 'upgrade.title')}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-600">
              {t(planStanding === 'some' ? 'upgrade.addBody' : 'upgrade.body')}
            </p>
          </div>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-violet-600/60" />
        </Link>
      )}

      <div
        style={{ '--rise-delay': '0.15s' } as React.CSSProperties}
        className="animate-rise flex flex-col gap-5"
      >
        {/* Account ------------------------------------------------------- */}
        {/* Administrators use this same account to check the user experience,
            so the two dashboards need a door between them in both directions.
            Without this the admin area was reachable only by typing /admin. */}
        {isAdmin && (
          <SettingsGroup title={t('groups.admin')}>
            <SettingsRow
              href="/admin"
              icon={<Gauge />}
              tone="violet"
              label={t('admin.dashboard')}
              description={t('admin.dashboardHint')}
            />
          </SettingsGroup>
        )}

        <SettingsGroup title={t('groups.account')}>
          <SettingsRow href="/profile/personal" icon={<UserRound />} tone="brand" label={t('account.personal')} description={t('account.personalHint')} />
          <SettingsRow href="/profile/payout" icon={<Wallet />} tone="teal" label={t('account.payout')} description={t('account.payoutHint')} />
          <SettingsRow href="/profile/pin" icon={<KeyRound />} tone="orange" label={t('account.pin')} description={t('account.pinHint')} />
        </SettingsGroup>

        {/* Security ------------------------------------------------------ */}
        <SettingsGroup title={t('groups.security')}>
          <SettingsRow href="/profile/2fa" icon={<ShieldCheck />} tone="success" label={t('security.twoFactor')} description={t('security.twoFactorHint')} value={twoFactor.enabled ? t('security.twoFactorOn') : t('security.twoFactorOff')} />
          <SettingsRow href="/profile/backup-codes" icon={<ListChecks />} tone="success" label={t('security.backupCodes')} description={t('security.backupCodesHint')} value={twoFactor.enabled ? t('security.backupCodesLeft', { count: twoFactor.backupCodesRemaining }) : undefined} />
          <SettingsRow href="/profile/password" icon={<Lock />} tone="brand" label={t('security.password')} />
          <SettingsRow href="/profile/email" icon={<Mail />} tone="brand" label={t('security.email')} value={user!.email} />
          <SettingsRow href="/profile/sessions" icon={<MonitorSmartphone />} tone="neutral" label={t('security.sessions')} description={t('security.sessionsHint')} />
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
          <SettingsRow
            href="/support"
            icon={<MessageCircle />}
            tone="neutral"
            label={t('support.help')}
            description={t('support.helpHint')}
          />
          <SettingsRow href="/privacy" icon={<FileText />} tone="neutral" label={t('support.privacy')} />
          <SettingsRow href="/terms" icon={<FileText />} tone="neutral" label={t('support.terms')} />
        </SettingsGroup>

        {/* Danger + logout ---------------------------------------------- */}
        <SettingsGroup>
          <SettingsRow href="/profile/delete" icon={<Trash2 />} danger label={t('danger.delete')} description={t('danger.deleteHint')} />
          <LogOutButton row />
        </SettingsGroup>

        <p className="pb-2 text-center text-[0.6875rem] text-ink-400">
          {t('version', { version: '0.1.0' })}
        </p>
      </div>
    </div>
  )
}
