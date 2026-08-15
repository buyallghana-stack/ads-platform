'use client'

import { useEffect, useState, useTransition } from 'react'

import {
  AlertCircle,
  CalendarCheck,
  Check,
  Clock,
  Coins,
  Sparkles,
  Users,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  claimWeeklyBonus,
  enrollWeeklyBonus,
  unenrollWeeklyBonus,
} from '@/app/[locale]/(app)/tasks/actions'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type {
  WeeklyBonusCampaign,
  WeeklyBonusStatus,
} from '@/lib/weekly-bonus/types'

/**
 * Weekly Bonus View.
 *
 * Recurring rewards for building an active, paid team across 2 levels (L1 + L2).
 *
 * Requirements & Logic:
 * 1. Referral count is strictly ACTIVE paid users (non-free subscriptions in active/grace status).
 * 2. Automatic tier qualification based on current count.
 * 3. Users can only be enrolled in one campaign tier at a time.
 * 4. A user cannot enter below their qualification level. Clicking on a tier gives direct feedback.
 * 5. Claims happen after the completed weekly cycle (previous completed Monday-Sunday cycle).
 */

export function WeeklyBonusView({
  status: initialStatus,
}: {
  status: WeeklyBonusStatus
}) {
  const t = useTranslations('weeklyBonus')
  const format = useFormatter()

  const [status, setStatus] = useState<WeeklyBonusStatus>(initialStatus)
  const [busy, setBusy] = useState<'enroll' | 'unenroll' | 'claim' | null>(null)
  const [won, setWon] = useState<{ amount: number; campaignName: string } | null>(null)
  const [toast, setToast] = useState<{
    type: 'error' | 'success' | 'info'
    message: string
  } | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  const [, startTransition] = useTransition()

  // Calculate live countdown to the next Monday 00:00 UTC (start of next claim cycle)
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date()
      const nextMonday = new Date(now)
      nextMonday.setUTCHours(0, 0, 0, 0)
      const day = nextMonday.getUTCDay()
      // If Sunday (0), next Monday is 1 day away. Otherwise (8 - day) days away.
      const daysUntilMonday = day === 0 ? 1 : 8 - day
      nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday)

      const diffMs = nextMonday.getTime() - now.getTime()
      if (diffMs <= 0) {
        setTimeRemaining('0d 0h 0m')
        return
      }

      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24)
      const minutes = Math.floor((diffMs / (1000 * 60)) % 60)

      setTimeRemaining(`${days}d ${hours}h ${minutes}m`)
    }

    updateCountdown()
    const timer = setInterval(updateCountdown, 60000)
    return () => clearInterval(timer)
  }, [])

  const showToast = (type: 'error' | 'success' | 'info', message: string) => {
    setToast({ type, message })
    const timeout = setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr))
    }, 4500)
    return () => clearTimeout(timeout)
  }

  // Handle enrollment
  const handleEnroll = () => {
    if (busy) return
    setBusy('enroll')
    setToast(null)

    startTransition(async () => {
      try {
        const result = await enrollWeeklyBonus()
        if (result.ok) {
          setStatus((prev) => ({
            ...prev,
            enrolled: true,
            matchedCampaign: result.matchedCampaign,
          }))
          showToast('success', t('enrolledSuccess'))
        } else {
          if (result.reason === 'not_qualified') {
            showToast('error', t('errors.not_qualified'))
          } else {
            showToast('error', t(`errors.${result.reason}`))
          }
        }
      } catch {
        showToast('error', t('errors.error'))
      } finally {
        setBusy(null)
      }
    })
  }

  // Handle unenrollment / leaving
  const handleUnenroll = () => {
    if (busy) return
    if (!window.confirm(t('leaveConfirm'))) return

    setBusy('unenroll')
    setToast(null)

    startTransition(async () => {
      try {
        const result = await unenrollWeeklyBonus()
        if (result.ok) {
          setStatus((prev) => ({
            ...prev,
            enrolled: false,
            canClaim: false,
          }))
          showToast('info', t('unregisteredSuccess'))
        } else {
          showToast('error', t(`errors.${result.reason}`))
        }
      } catch {
        showToast('error', t('errors.error'))
      } finally {
        setBusy(null)
      }
    })
  }

  // Handle claiming weekly reward
  const handleClaim = () => {
    if (busy || !status.canClaim) return
    setBusy('claim')
    setToast(null)
    setWon(null)

    startTransition(async () => {
      try {
        const result = await claimWeeklyBonus()
        if (result.ok) {
          setWon({
            amount: result.rewardGhs,
            campaignName: result.campaignName,
          })
          setStatus((prev) => ({
            ...prev,
            canClaim: false,
            lastClaimWeek: result.weekStart,
          }))
          setTimeout(() => setWon(null), 4000)
        } else {
          if (result.reason === 'not_qualified') {
            showToast(
              'error',
              t('countDropped', {
                count: status.activeReferrals,
                min: status.campaigns[0]?.minReferrals ?? 20,
              }),
            )
          } else {
            showToast('error', t(`errors.${result.reason}`))
          }
        }
      } catch {
        showToast('error', t('errors.error'))
      } finally {
        setBusy(null)
      }
    })
  }

  // Handle clicking on an individual campaign card to give instant feedback
  const handleTierClick = (campaign: WeeklyBonusCampaign) => {
    const activeCount = status.activeReferrals
    const minRequired = campaign.minReferrals
    const maxAllowed = campaign.maxReferrals

    // Scenario 1: User has not met minimum requirement overall (< 20 active referrals)
    if (activeCount < 20) {
      showToast('error', t('notQualified', { min: minRequired }))
      return
    }

    // Scenario 2: User has more referrals than this tier's maximum
    if (maxAllowed !== null && activeCount > maxAllowed) {
      const higherTier =
        status.matchedCampaign?.name ?? t('yourTier')
      const higherReward = status.matchedCampaign
        ? format.number(status.matchedCampaign.rewardGhs, {
            style: 'currency',
            currency: 'GHS',
          })
        : ''
      showToast(
        'info',
        t('cannotJoinLower', {
          count: activeCount,
          campaign: higherTier,
          reward: higherReward,
        }),
      )
      return
    }

    // Scenario 3: User hasn't reached this higher tier yet
    if (activeCount < minRequired) {
      const needed = minRequired - activeCount
      showToast('info', t('needMoreReferrals', { count: needed }))
      return
    }

    // Scenario 4: User is on this tier! If not enrolled, enroll them
    if (!status.enrolled) {
      handleEnroll()
    } else {
      showToast(
        'success',
        t('overQualified', {
          count: activeCount,
          campaign: campaign.name,
          reward: format.number(campaign.rewardGhs, {
            style: 'currency',
            currency: 'GHS',
          }),
        }),
      )
    }
  }

  const qualifyingTier = status.campaigns.find(
    (c) =>
      c.minReferrals <= status.activeReferrals &&
      (c.maxReferrals === null || status.activeReferrals <= c.maxReferrals),
  )

  return (
    <div className="space-y-4">
      {/* Toast Alert */}
      {toast && (
        <div
          role="alert"
          className={cn(
            'animate-rise flex items-center justify-center gap-2 rounded-(--radius-input) border px-4 py-2.5 text-center text-[0.8125rem] font-medium shadow-sm transition-all',
            toast.type === 'error'
              ? 'border-danger-500/30 bg-danger-50 text-danger-700'
              : toast.type === 'success'
                ? 'border-success-500/30 bg-success-50 text-success-700'
                : 'border-brand-500/30 bg-brand-50 text-brand-700',
          )}
        >
          {toast.type === 'error' ? (
            <AlertCircle aria-hidden className="size-4 shrink-0" />
          ) : toast.type === 'success' ? (
            <Check aria-hidden className="size-4 shrink-0" />
          ) : (
            <Sparkles aria-hidden className="size-4 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Claim Celebration Banner */}
      {won && (
        <div
          role="status"
          className="animate-rise flex items-center justify-center gap-2.5 rounded-(--radius-panel) border border-success-500/30 bg-success-50 p-4 text-center text-success-800"
        >
          <Coins aria-hidden className="size-5 shrink-0 text-success-600" />
          <p className="text-[0.9375rem] font-bold">
            {t('claimed', {
              amount: format.number(won.amount, { minimumFractionDigits: 2 }),
              campaign: won.campaignName,
            })}
          </p>
        </div>
      )}

      {/* Active Referrals Hero Card */}
      <section
        className="animate-rise relative overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface p-5 shadow-xs"
        style={{ '--rise-delay': '0s' } as React.CSSProperties}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
              <Users aria-hidden className="size-5.5" />
            </div>
            <div>
              <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
                {t('activeReferrals')}
              </p>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[1.875rem] leading-none font-bold text-ink-900 tabular-nums">
                  {format.number(status.activeReferrals)}
                </span>
                <span className="text-[0.8125rem] text-ink-500">
                  {t('referralCount', { count: status.activeReferrals })}
                </span>
              </div>
              <p className="mt-1 text-[0.75rem] text-ink-400">
                {t('levelsCombined')}
              </p>
            </div>
          </div>

          {/* User Status / Action Button */}
          <div className="flex flex-col sm:items-end gap-2">
            {status.enrolled ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-[0.75rem] font-bold text-success-700">
                    <span aria-hidden className="size-1.5 rounded-full bg-success-500" />
                    {t('enrolled')}
                  </span>
                  <button
                    type="button"
                    onClick={handleUnenroll}
                    disabled={busy !== null}
                    className="text-[0.75rem] font-medium text-ink-400 hover:text-danger-600 transition-colors"
                  >
                    {t('leaveButton')}
                  </button>
                </div>

                {status.matchedCampaign && (
                  <p className="text-[0.8125rem] font-semibold text-ink-700">
                    {status.matchedCampaign.name} ·{' '}
                    <span className="text-brand-600">
                      GHS{' '}
                      {format.number(status.matchedCampaign.rewardGhs, {
                        minimumFractionDigits: 2,
                      })}
                      /{t('weekShort')}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <Button
                onClick={handleEnroll}
                loading={busy === 'enroll'}
                disabled={busy !== null}
                size="md"
              >
                <CalendarCheck aria-hidden className="size-4" />
                {t('joinButton')}
              </Button>
            )}
          </div>
        </div>

        {/* Claim Bar / Countdown */}
        {status.enrolled && (
          <div className="mt-4 pt-4 border-t border-ink-100 flex flex-wrap items-center justify-between gap-3">
            {status.canClaim ? (
              <div className="flex items-center justify-between w-full gap-3">
                <div className="flex items-center gap-2 text-success-700">
                  <Sparkles aria-hidden className="size-4 text-success-600" />
                  <span className="text-[0.8125rem] font-semibold">
                    {t('claimAvailable')}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={handleClaim}
                  loading={busy === 'claim'}
                  disabled={busy !== null}
                >
                  {t('claimButton', {
                    amount: format.number(
                      status.matchedCampaign?.rewardGhs ?? 0,
                      { minimumFractionDigits: 2 },
                    ),
                  })}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-ink-500 text-[0.8125rem]">
                <Clock aria-hidden className="size-4 text-ink-400" />
                <span>
                  {t('nextClaimIn')}{' '}
                  <span className="font-semibold text-ink-900 tabular-nums">
                    {timeRemaining || '...'}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Campaign Tiers List */}
      <section
        className="animate-rise space-y-2.5"
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">
            {t('campaignTiers')}
          </h2>
          <span className="text-[0.75rem] text-ink-400">
            {status.campaigns.length} tiers
          </span>
        </div>

        {status.campaigns.length === 0 ? (
          <p className="rounded-(--radius-panel) border border-dashed border-ink-200 px-6 py-12 text-center text-[0.875rem] text-ink-500">
            {t('noCampaigns')}
          </p>
        ) : (
          <ol className="space-y-2">
            {status.campaigns.map((campaign, index) => {
              const isUserTier = qualifyingTier?.id === campaign.id
              const isAboveQualification =
                campaign.maxReferrals !== null &&
                status.activeReferrals > campaign.maxReferrals

              return (
                <li
                  key={campaign.id}
                  onClick={() => handleTierClick(campaign)}
                  style={
                    {
                      '--rise-delay': `${0.06 + Math.min(index, 10) * 0.02}s`,
                    } as React.CSSProperties
                  }
                  className={cn(
                    'animate-rise flex cursor-pointer items-center justify-between rounded-(--radius-panel) border p-3.5 transition-all',
                    isUserTier
                      ? 'border-brand-500/50 bg-brand-50/50 shadow-xs ring-1 ring-brand-500/20'
                      : 'border-ink-200 bg-surface hover:border-ink-300 hover:bg-canvas/40',
                    isAboveQualification && 'opacity-70',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          'text-[0.875rem] font-semibold truncate',
                          isUserTier ? 'text-brand-950' : 'text-ink-900',
                        )}
                      >
                        {campaign.name}
                      </p>
                      {isUserTier && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[0.6875rem] font-bold text-white shadow-xs">
                          ⭐ {t('yourTier')}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-[0.75rem] text-ink-500 font-mono">
                      {campaign.maxReferrals === null
                        ? t('referralsRangeOpen', {
                            min: campaign.minReferrals,
                          })
                        : t('referralsRange', {
                            min: campaign.minReferrals,
                            max: campaign.maxReferrals,
                          })}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3 text-right">
                    <div>
                      <p
                        className={cn(
                          'text-[0.9375rem] font-bold tabular-nums',
                          isUserTier ? 'text-brand-700' : 'text-success-700',
                        )}
                      >
                        GHS{' '}
                        {format.number(campaign.rewardGhs, {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-[0.6875rem] text-ink-400">
                        /{t('week')}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
