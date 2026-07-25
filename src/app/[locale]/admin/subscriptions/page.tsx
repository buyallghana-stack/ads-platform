import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Subscriptions',
  robots: { index: false, follow: false },
}

/**
 * Subscriptions — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.subscriptions')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={true}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Plan revenue', body: 'What each plan brought in, and how many people hold it.', backend: 'subscription_payments + tiers' },
          { title: 'Active subscribers', body: 'Who holds what, when it started, when it lapses.', backend: 'user_subscriptions' },
          { title: 'Stacking view', body: 'Which combinations people actually buy — the thing that decides whether the multipliers are priced right.', backend: 'resolve_user_tier()' },
          { title: 'Cancel or extend', body: 'Intervene on one subscription without touching the ledger.', backend: 'cancel_subscription()' },
          { title: 'Failed payments', body: 'Payments that started and never confirmed.', backend: 'subscription_payments.status' },
          { title: 'Plan editing', body: 'Price, daily cap, multiplier and payout threshold per plan.', backend: 'tiers (admin RLS)' },
        ]}
      />
    </>
  )
}
