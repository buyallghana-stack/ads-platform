import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Config',
  robots: { index: false, follow: false },
}

/**
 * Config — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.config')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={true}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Earning limits', body: 'Per-user daily points ceiling, cooldown between ads, retry cap per ad.', backend: 'per_user_daily_points_cap, ad_retry_cap' },
          { title: 'Reward pool', body: 'Platform-wide daily ceiling, and whether reaching it alerts or stops earning.', backend: 'reward_pool_daily_ceiling_points, reward_pool_ceiling_blocks' },
          { title: 'Payout rules', body: 'Holding window, payout-details cool-off, and the master payouts switch.', backend: 'redemption_holding_hours, payouts_enabled' },
          { title: 'Kill switch', body: 'Pause all earning platform-wide.', backend: 'earning_paused_globally' },
          { title: 'Referral bonuses', body: 'Signup and activation bonus points, and how many ads count as activation.', backend: 'referral_signup_bonus_points' },
          { title: 'Fraud thresholds', body: 'Risk scores at which an account is rated medium, high or critical.', backend: 'fraud_threshold_*' },
          { title: 'Points rate', body: 'How many points make one cedi. Forward-only — history keeps the rate it was written at.', backend: 'points_per_currency_unit' },
          { title: 'Stacking', body: 'Whether plans stack, how multipliers combine, and the hard ceiling on the combined rate.', backend: 'subscription_multiplier_combine_mode' },
        ]}
      />
    </>
  )
}
