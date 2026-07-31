import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { SettingsForm, type FieldGroup } from '@/components/admin/SettingsForm'
import { getPlatformConfig } from '@/lib/admin/data/config'

import { saveConfig } from './actions'

export const metadata: Metadata = {
  title: 'Admin · Platform settings',
  robots: { index: false, follow: false },
}

/**
 * Platform settings — the numbers that decide how much money leaves.
 *
 * Every field here maps to a real column the database already reads, and the
 * column name is printed under each label rather than hidden: an operator
 * debugging with the database open should not have to guess which key
 * "Daily points cap" writes to.
 *
 * The groups are ordered by how often they are touched, not by how the
 * database happens to store them — earning limits weekly, the kill switch
 * hopefully never. The two that can quietly cost real money (the points rate
 * and the kill switch) carry a warning stating the consequence in terms of
 * users rather than of columns.
 *
 * REAL AS OF 2026-07-29. Values come from `app_config` and saving calls
 * `admin_set_config`.
 *
 * Wiring it turned up five keys on this screen that did not exist in the
 * database — `ad_cooldown_seconds`, `payout_details_cooloff_hours`,
 * `subscription_multiplier_ceiling`, `referral_activation_ads`, and a
 * `multiply` combine mode that `resolve_user_tier` has no branch for. While
 * the screen only rendered invented numbers that cost nothing; on the first
 * real save each would have been an "Unknown setting" or, in the combine
 * mode's case, a value that silently behaved as something else. They are
 * corrected here, and `admin_set_config` now refuses unknown keys outright so
 * the next drift fails loudly instead of quietly.
 *
 * The min/max on each numeric field below are DISPLAY hints for the input.
 * The limits that actually hold are the ones on each `app_config` row, which
 * is what the writer validates against.
 */
export default async function AdminConfigPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.config')

  const groups: FieldGroup[] = [
    {
      key: 'earning',
      title: t('groups.earning.title'),
      description: t('groups.earning.description'),
      fields: [
        {
          key: 'per_user_daily_points_cap',
          label: t('fields.dailyCap.label'),
          description: t('fields.dailyCap.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
        {
          key: 'ad_cooldown_seconds_default',
          label: t('fields.cooldown.label'),
          description: t('fields.cooldown.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.seconds'),
        },
        {
          key: 'ad_retry_cap',
          label: t('fields.retryCap.label'),
          description: t('fields.retryCap.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.attempts'),
        },
      ],
    },
    {
      key: 'pool',
      title: t('groups.pool.title'),
      description: t('groups.pool.description'),
      fields: [
        {
          key: 'reward_pool_daily_ceiling_points',
          label: t('fields.poolCeiling.label'),
          description: t('fields.poolCeiling.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
        {
          key: 'reward_pool_ceiling_blocks',
          label: t('fields.poolBlocks.label'),
          description: t('fields.poolBlocks.description'),
          warning: t('fields.poolBlocks.warning'),
          kind: 'toggle',
        },
      ],
    },
    {
      key: 'payouts',
      title: t('groups.payouts.title'),
      description: t('groups.payouts.description'),
      fields: [
        {
          key: 'payouts_enabled',
          label: t('fields.payoutsEnabled.label'),
          description: t('fields.payoutsEnabled.description'),
          kind: 'toggle',
        },
        {
          key: 'redemption_holding_hours',
          label: t('fields.holdingHours.label'),
          description: t('fields.holdingHours.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.hours'),
        },
        {
          key: 'payout_details_change_cooloff_hours',
          label: t('fields.cooloffHours.label'),
          description: t('fields.cooloffHours.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.hours'),
        },
      ],
    },
    {
      key: 'rate',
      title: t('groups.rate.title'),
      description: t('groups.rate.description'),
      fields: [
        {
          key: 'points_per_currency_unit',
          label: t('fields.pointsRate.label'),
          description: t('fields.pointsRate.description'),
          warning: t('fields.pointsRate.warning'),
          kind: 'number',
          min: 1,
          suffix: t('units.perCedi'),
        },
        {
          key: 'subscription_multiplier_combine_mode',
          label: t('fields.combineMode.label'),
          description: t('fields.combineMode.description'),
          kind: 'select',
          /* These four are exactly the branches `resolve_user_tier`
             implements — sum_bonus, sum, product, and the else-branch that
             takes the highest. The screen used to offer `multiply`, which is
             not one of them: selecting it would have fallen through to the
             else and silently applied "highest" instead of multiplying.
             `config_allowed_values` now refuses anything outside this set, so
             the two lists cannot drift apart again without a save failing
             loudly. */
          options: [
            { value: 'sum_bonus', label: t('fields.combineMode.sumBonus') },
            { value: 'sum', label: t('fields.combineMode.sum') },
            { value: 'product', label: t('fields.combineMode.product') },
            { value: 'highest', label: t('fields.combineMode.highest') },
          ],
        },
        {
          key: 'subscription_max_combined_multiplier',
          label: t('fields.multiplierCeiling.label'),
          description: t('fields.multiplierCeiling.description'),
          kind: 'number',
          min: 1,
          step: 0.5,
          suffix: t('units.times'),
        },
      ],
    },
    {
      key: 'referrals',
      title: t('groups.referrals.title'),
      description: t('groups.referrals.description'),
      fields: [
        {
          key: 'referral_signup_bonus_points',
          label: t('fields.referralSignup.label'),
          description: t('fields.referralSignup.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
        {
          key: 'referral_signup_bonus_points_l2',
          label: t('fields.referralSignupL2.label'),
          description: t('fields.referralSignupL2.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
        {
          key: 'referral_activation_bonus_points',
          label: t('fields.referralActivation.label'),
          description: t('fields.referralActivation.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
        {
          key: 'referral_activation_bonus_points_l2',
          label: t('fields.referralActivationL2.label'),
          description: t('fields.referralActivationL2.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
        {
          key: 'referral_activation_ads_required',
          label: t('fields.referralAds.label'),
          description: t('fields.referralAds.description'),
          kind: 'number',
          min: 1,
          suffix: t('units.ads'),
        },
        {
          key: 'referral_purchase_commission_percent',
          label: t('fields.referralCommission.label'),
          description: t('fields.referralCommission.description'),
          kind: 'number',
          min: 0,
          max: 50,
          step: 0.5,
          suffix: t('units.percent'),
        },
        {
          /* Level two is paid out of what level one leaves, so these two are
             not independent: the screen shows them together because setting
             the second without seeing the first is how somebody ends up
             giving away the whole sale. */
          key: 'referral_purchase_commission_percent_l2',
          label: t('fields.referralCommissionL2.label'),
          description: t('fields.referralCommissionL2.description'),
          kind: 'number',
          min: 0,
          max: 50,
          step: 0.5,
          suffix: t('units.percent'),
        },
        {
          key: 'referral_purchase_commission_scope',
          label: t('fields.referralCommissionScope.label'),
          description: t('fields.referralCommissionScope.description'),
          kind: 'select',
          /* The same three branches `pay_referral_purchase_commission`
             implements, and the same guard: `config_allowed_values` refuses
             anything outside this set, so the screen and the function cannot
             drift apart without a save failing loudly. */
          options: [
            { value: 'new_plans', label: t('fields.referralCommissionScope.newPlans') },
            { value: 'first', label: t('fields.referralCommissionScope.first') },
            { value: 'all', label: t('fields.referralCommissionScope.all') },
          ],
        },
        {
          key: 'referral_purchase_commission_cap_points',
          label: t('fields.referralCommissionCap.label'),
          description: t('fields.referralCommissionCap.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.points'),
        },
      ],
    },
    {
      key: 'fraud',
      title: t('groups.fraud.title'),
      description: t('groups.fraud.description'),
      fields: [
        {
          key: 'fraud_threshold_medium',
          label: t('fields.fraudMedium.label'),
          description: t('fields.fraudMedium.description'),
          kind: 'number',
          min: 0,
          max: 100,
        },
        {
          key: 'fraud_threshold_high',
          label: t('fields.fraudHigh.label'),
          description: t('fields.fraudHigh.description'),
          kind: 'number',
          min: 0,
          max: 100,
        },
        {
          key: 'fraud_threshold_critical',
          label: t('fields.fraudCritical.label'),
          description: t('fields.fraudCritical.description'),
          kind: 'number',
          min: 0,
          max: 100,
        },
      ],
    },
    {
      /* Added 2026-07-30. These keys existed in `app_config` from the day the
         games shipped, and `admin_set_config` would have accepted them — but
         this screen renders a HAND-WRITTEN field list, not every row in the
         table, so a setting nobody adds here is a setting nobody can reach.
         The operator went looking for the games switch and found nothing.
         Any new config row now needs a field here in the same change. */
      key: 'games',
      title: t('groups.games.title'),
      description: t('groups.games.description'),
      fields: [
        {
          key: 'games_enabled',
          label: t('fields.gamesEnabled.label'),
          description: t('fields.gamesEnabled.description'),
          warning: t('fields.gamesEnabled.warning'),
          danger: true,
          kind: 'toggle',
        },
        {
          key: 'game_plays_combine_mode',
          label: t('fields.gameCombineMode.label'),
          description: t('fields.gameCombineMode.description'),
          kind: 'select',
          /* Exactly the two branches `user_weekly_play_allowance` implements.
             `config_allowed_values` refuses anything else, so this list and
             the code cannot drift apart without a save failing loudly. */
          options: [
            { value: 'highest', label: t('fields.gameCombineMode.highest') },
            { value: 'sum_bonus', label: t('fields.gameCombineMode.sumBonus') },
          ],
        },
        {
          key: 'game_min_seconds_between_plays',
          label: t('fields.gameGap.label'),
          description: t('fields.gameGap.description'),
          kind: 'number',
          min: 0,
          suffix: t('units.seconds'),
        },
      ],
    },
    {
      key: 'leaderboard',
      title: t('groups.leaderboard.title'),
      description: t('groups.leaderboard.description'),
      fields: [
        {
          key: 'leaderboard_visible_ranks',
          label: t('fields.leaderboardRanks.label'),
          description: t('fields.leaderboardRanks.description'),
          kind: 'number',
          min: 3,
          suffix: t('units.places'),
        },
        {
          key: 'leaderboard_counts_granted_points',
          label: t('fields.leaderboardGranted.label'),
          description: t('fields.leaderboardGranted.description'),
          kind: 'toggle',
        },
        {
          key: 'leaderboard_shows_zero_earners',
          label: t('fields.leaderboardZeros.label'),
          description: t('fields.leaderboardZeros.description'),
          kind: 'toggle',
        },
        {
          key: 'gift_code_max_attempts_per_hour',
          label: t('fields.giftAttempts.label'),
          description: t('fields.giftAttempts.description'),
          kind: 'number',
          min: 1,
          suffix: t('units.perHour'),
        },
      ],
    },
    {
      key: 'killswitch',
      title: t('groups.killswitch.title'),
      description: t('groups.killswitch.description'),
      fields: [
        {
          key: 'earning_paused_globally',
          label: t('fields.earningPaused.label'),
          description: t('fields.earningPaused.description'),
          warning: t('fields.earningPaused.warning'),
          danger: true,
          kind: 'toggle',
        },
      ],
    },
  ]

  const { values } = await getPlatformConfig()

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsForm groups={groups} initial={values} onSave={saveConfig} />
    </>
  )
}
