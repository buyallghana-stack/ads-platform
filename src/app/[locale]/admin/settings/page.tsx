import type { Metadata } from 'next'

import { ShieldCheck } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader, PersonCell, StatusDot } from '@/components/admin/AdminChrome'
import { SettingsForm, type FieldGroup } from '@/components/admin/SettingsForm'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { administrators } from '@/lib/admin/preview'

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
 * The administrator list is read-only for now and says so. Granting the admin
 * role is the one action on this screen that cannot be undone from this
 * screen — a mis-grant hands somebody the payout queue — so it waits for the
 * backend rather than shipping as a button that half works.
 */
export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.adminSettings')

  const admins = administrators()

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
          key: 'admin_session_hours',
          label: t('fields.sessionHours.label'),
          description: t('fields.sessionHours.description'),
          kind: 'number',
          min: 1,
          max: 720,
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

        <ul className="divide-y divide-ink-200">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <PersonCell name={a.name} secondary={a.email} />
              </div>
              <StatusDot tone={a.twoFactor ? 'success' : 'warning'}>
                {t(a.twoFactor ? 'administrators.twoFactorOn' : 'administrators.twoFactorOff')}
              </StatusDot>
            </li>
          ))}
        </ul>

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

      <SettingsForm
        groups={groups}
        initial={{
          require_admin_2fa: false,
          admin_session_hours: 168,
          alert_on_payout_request: true,
          alert_on_pool_ceiling: true,
          alert_on_critical_risk: true,
        }}
      />
    </>
  )
}
