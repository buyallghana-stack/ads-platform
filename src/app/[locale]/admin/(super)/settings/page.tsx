import type { Metadata } from 'next'

import { ShieldCheck } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { SettingsForm, type FieldGroup } from '@/components/admin/SettingsForm'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { saveConfig } from '@/app/[locale]/admin/(super)/config/actions'
import { AdministratorsBoard } from '@/components/admin/AdministratorsBoard'
import { getAdministrators } from '@/lib/admin/data/administrators'
import { getPlatformConfig } from '@/lib/admin/data/config'

export const metadata: Metadata = {
  title: 'Admin · Admin settings',
  robots: { index: false, follow: false },
}

/**
 * Admin settings — who can get in here, and how this area behaves.
 *
 * Distinct from Platform settings on purpose: that screen decides what
 * happens to users' money, this one decides who is allowed to touch it. They
 * are different blast radii and mixing them into one long form is how the
 * kill switch ends up two rows below a theme preference.
 *
 * REAL AS OF 2026-07-29. The administrator list comes from `user_roles`, and
 * every control below writes through `admin_set_config` — the same writer the
 * platform-settings screen uses, so two screens cannot disagree about how a
 * setting is validated.
 *
 * The list stays READ-ONLY on purpose. Granting the admin role is the one
 * action here that cannot be undone from here — a mis-grant hands somebody the
 * payout queue — and with exactly one administrator today, a revoke button is
 * a way to lock the only operator out of their own platform. It stays a
 * deliberate database action until the operator asks for it.
 */
export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.adminSettings')

  const [admins, config] = await Promise.all([getAdministrators(), getPlatformConfig()])

  const groups: FieldGroup[] = [
    {
      key: 'security',
      title: t('groups.security.title'),
      description: t('groups.security.description'),
      fields: [
        {
          key: 'require_admin_2fa',
          label: t('fields.require2fa.label'),
          description: t('fields.require2fa.description'),
          warning: t('fields.require2fa.warning'),
          kind: 'toggle',
        },
        {
          /*
            Was `admin_session_hours`, which did not exist and could not have.
            There is no admin session distinct from a user session — signing in
            is signing in — and the only admin-relevant timer in the system is
            how long a passed two-factor check lasts before it is asked for
            again. This is that timer, under a name that says so. It applies to
            everybody with 2FA enrolled, and the description says so rather
            than implying an admin-only scope it does not have.
          */
          key: 'two_factor_recheck_hours',
          label: t('fields.recheckHours.label'),
          description: t('fields.recheckHours.description'),
          kind: 'number',
          min: config.meta.two_factor_recheck_hours?.min ?? 1,
          max: config.meta.two_factor_recheck_hours?.max ?? 720,
          suffix: t('units.hours'),
        },
      ],
    },
    {
      key: 'alerts',
      title: t('groups.alerts.title'),
      description: t('groups.alerts.description'),
      fields: [
        {
          key: 'alert_on_payout_request',
          label: t('fields.alertPayout.label'),
          description: t('fields.alertPayout.description'),
          kind: 'toggle',
        },
        {
          key: 'alert_on_pool_ceiling',
          label: t('fields.alertCeiling.label'),
          description: t('fields.alertCeiling.description'),
          kind: 'toggle',
        },
        {
          key: 'alert_on_critical_risk',
          label: t('fields.alertRisk.label'),
          description: t('fields.alertRisk.description'),
          kind: 'toggle',
        },
      ],
    },
  ]

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {/* ---- Who has the keys ------------------------------------------ */}
      <section className="mb-4 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
        <div className="border-b border-ink-200 px-4 py-3.5">
          <h2 className="text-[0.875rem] font-semibold tracking-[-0.01em] text-ink-900">
            {t('administrators.title')}
          </h2>
          <p className="mt-1 max-w-[70ch] text-[0.75rem] leading-relaxed text-ink-500">
            {t('administrators.description')}
          </p>
        </div>

        <AdministratorsBoard initial={admins} />

        {/* Said plainly, because the setting above can send every one of them
            to an enrolment screen and the operator should know that before
            they switch it on rather than after. */}
        {admins.length > 0 && admins.every((a) => !a.twoFactor) && (
          <p className="border-t border-ink-200 bg-warning-50 px-4 py-3 text-[0.75rem] leading-relaxed text-warning-600">
            {t('administrators.noneProtected')}
          </p>
        )}

        <p className="flex items-start gap-2 border-t border-ink-200 bg-ink-50 px-4 py-3 text-[0.75rem] leading-relaxed text-ink-500">
          <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0 text-ink-400" />
          {t('administrators.note')}
        </p>
      </section>

      {/* ---- Appearance ------------------------------------------------
          Lives here rather than in Platform settings because it changes what
          this operator sees, not what any user gets. */}
      <section className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[0.875rem] font-semibold tracking-[-0.01em] text-ink-900">
            {t('appearance.title')}
          </h2>
          <p className="mt-1 max-w-[70ch] text-[0.75rem] leading-relaxed text-ink-500">
            {t('appearance.description')}
          </p>
        </div>
        <ThemeToggle />
      </section>

      {/* The same writer the platform-settings screen uses: `admin_set_config`
          validates each value against that row's own type and bounds, and
          returns only what actually changed. Two screens, one write path. */}
      <SettingsForm
        groups={groups}
        initial={{
          require_admin_2fa: config.values.require_admin_2fa,
          two_factor_recheck_hours: config.values.two_factor_recheck_hours,
          alert_on_payout_request: config.values.alert_on_payout_request,
          alert_on_pool_ceiling: config.values.alert_on_pool_ceiling,
          alert_on_critical_risk: config.values.alert_on_critical_risk,
        }}
        onSave={saveConfig}
      />
    </>
  )
}
