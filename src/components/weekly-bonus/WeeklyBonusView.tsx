'use client'

import { useEffect, useState, useTransition } from 'react'

import {
  CalendarCheck,
  Clock,
  Coins,
  Gift,
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
 * Implements recurring rewards for maintaining active referred users on paid plans
 * across 2 levels (L1 + L2). Follows the standard SidePerks visual design language.
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

  // Calculate live countdown to next Monday 00:00 UTC
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date()
      const nextMonday = new Date(now)
      nextMonday.setUTCHours(0, 0, 0, 0)
      const day = nextMonday.getUTCDay()
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

  // Handle unenrollment
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

  // Handle claim
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

  // Interaction feedback when clicking on a tier card
  const handleTierClick = (campaign: WeeklyBonusCampaign) => {
    const activeCount = status.activeReferrals
    const minRequired = campaign.minReferrals
    const maxAllowed = campaign.maxReferrals

    // Rule 1: User has < 20 active referrals
    if (activeCount < 20) {
      showToast('error', t('notQualified', { min: minRequired }))
      return
    }

    // Rule 2: User has more referrals than this tier
    if (maxAllowed !== null && activeCount > maxAllowed) {
      const higherTier = status.matchedCampaign?.name ?? t('yourTier')
      const higherReward = status.matchedCampaign
        ? `GHS ${format.number(status.matchedCampaign.rewardGhs, { minimumFractionDigits: 2 })}/${t('weekShort')}`
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

    // Rule 3: User needs more referrals to reach this tier
    if (activeCount < minRequired) {
      const needed = minRequired - activeCount
      showToast('info', t('needMoreReferrals', { count: needed }))
      return
    }

    // Rule 4: User is currently on this tier
    if (!status.enrolled) {
      handleEnroll()
    } else {
      showToast(
        'success',
        t('overQualified', {
          count: activeCount,
          campaign: campaign.name,
          reward: `GHS ${format.number(campaign.rewardGhs, { minimumFractionDigits: 2 })}/${t('weekShort')}`,
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
    <>
      {/* ---- Active Referrals & Status Meter Card ----------------------- */}
      <section
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise rounded-(--radius-panel) border border-ink-200 bg-surface px-4 py-3.5 sm:px-5"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
              {t('activeReferrals')}
            </p>
            <p className="mt-1 text-[1.375rem] leading-none font-bold text-ink-900 tabular-nums">
              {format.number(status.activeReferrals)}
              <span className="text-[0.8125rem] font-medium text-ink-400">
                {' '}{t('levelsCombinedHint')}
              </span>
            </p>
          </div>

          <div className="text-right">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-400 uppercase">
              {status.enrolled ? t('currentStatus') : t('programme')}
            </p>
            {status.enrolled ? (
              <p className="mt-1 text-[0.875rem] leading-none font-semibold text-brand-600">
                {status.matchedCampaign ? (
                  <>
                    GHS {format.number(status.matchedCampaign.rewardGhs, { minimumFractionDigits: 2 })}
                    <span className="text-[0.75rem] font-medium text-ink-400">/{t('weekShort')}</span>
                  </>
                ) : (
                  <span className="text-[0.75rem] text-ink-400">{t('pendingQualification')}</span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-[0.8125rem] leading-none font-semibold text-ink-500">
                {t('notEnrolled')}
              </p>
            )}
          </div>
        </div>

        {/* Level 1 + Level 2 helper note */}
        <p className="mt-2.5 text-[0.75rem] text-ink-500">
          {t('levelsCombined')}
        </p>

        {/* Card action row (Join, Claim, or Countdown) */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 border-t border-ink-100 pt-3">
          {!status.enrolled ? (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-[0.8125rem] text-ink-600">
                {status.activeReferrals >= 20
                  ? t('qualifiedToJoin', { tier: qualifyingTier?.name ?? '' })
                  : t('needMinimumToJoin', { min: 20 })}
              </span>
              <Button
                size="sm"
                onClick={handleEnroll}
                loading={busy === 'enroll'}
                disabled={busy !== null}
              >
                <CalendarCheck aria-hidden className="size-4" />
                {t('joinButton')}
              </Button>
            </div>
          ) : status.canClaim ? (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-[0.8125rem] font-semibold text-success-700">
                {t('claimAvailable')}
              </span>
              <Button
                size="sm"
                onClick={handleClaim}
                loading={busy === 'claim'}
                disabled={busy !== null}
              >
                {t('claimButton', {
                  amount: format.number(status.matchedCampaign?.rewardGhs ?? 0, {
                    minimumFractionDigits: 2,
                  }),
                })}
              </Button>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between gap-2 text-[0.75rem] text-ink-500">
              <div className="flex items-center gap-1.5">
                <Clock aria-hidden className="size-3.5 text-ink-400" />
                <span>
                  {t('nextClaimIn')}{' '}
                  <span className="font-semibold text-ink-900 tabular-nums">
                    {timeRemaining || '...'}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={handleUnenroll}
                disabled={busy !== null}
                className="text-[0.6875rem] font-medium text-ink-400 transition-colors hover:text-danger-600"
              >
                {t('leaveButton')}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Claim Celebration Banner matching Tasks summary style */}
      {won && (
        <div
          role="status"
          style={{ '--rise-delay': '0.06s' } as React.CSSProperties}
          className="animate-rise mt-4 flex items-center gap-3 rounded-(--radius-panel) border border-success-500/25 bg-success-50 px-4 py-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-500/15 text-success-700">
            <Coins aria-hidden className="size-4.5" />
          </span>
          <p className="text-[0.8125rem] font-semibold text-success-700">
            {t('claimed', {
              amount: format.number(won.amount, { minimumFractionDigits: 2 }),
              campaign: won.campaignName,
            })}
          </p>
        </div>
      )}

      {/* Feedback Toast / Alert matching Tasks style */}
      {toast && (
        <p
          role="alert"
          className={cn(
            'animate-rise mt-4 rounded-(--radius-input) border px-3.5 py-2.5 text-center text-[0.8125rem]',
            toast.type === 'error'
              ? 'border-danger-500/25 bg-danger-50 text-danger-700'
              : toast.type === 'success'
                ? 'border-success-500/25 bg-success-50 text-success-700'
                : 'border-brand-500/25 bg-brand-50 text-brand-700',
          )}
        >
          {toast.message}
        </p>
      )}

      {/* Campaign Tiers List matching TasksView / TeamView style */}
      {status.campaigns.length === 0 ? (
        <p className="mt-6 rounded-(--radius-panel) border border-dashed border-ink-200 px-6 py-12 text-center text-[0.875rem] text-ink-500">
          {t('noCampaigns')}
        </p>
      ) : (
        <ol className="mt-4 space-y-2.5">
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
                    '--rise-delay': `${0.08 + Math.min(index, 10) * 0.02}s`,
                  } as React.CSSProperties
                }
                className={cn(
                  'animate-rise flex cursor-pointer items-center justify-between rounded-(--radius-panel) border bg-surface p-4 transition-colors',
                  isUserTier
                    ? 'border-brand-500/40 shadow-[0_1px_2px_rgb(15_23_42/0.06)]'
                    : 'border-ink-200 hover:border-ink-300',
                  isAboveQualification && 'opacity-65',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-full text-base',
                      isUserTier
                        ? 'bg-brand-50 text-brand-600'
                        : 'bg-ink-100 text-ink-500',
                    )}
                  >
                    <Gift aria-hidden className="size-5" />
                  </span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[0.875rem] font-semibold text-ink-900">
                        {campaign.name}
                      </p>
                      {isUserTier && (
                        <span className="rounded-full border border-brand-500/30 bg-brand-50 px-2 py-0.5 text-[0.6875rem] font-bold text-brand-700">
                          ⭐ {t('yourTier')}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 font-mono text-[0.75rem] text-ink-500">
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
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[0.9375rem] font-bold tabular-nums text-ink-900">
                    GHS{' '}
                    {format.number(campaign.rewardGhs, {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-[0.6875rem] text-ink-400">
                    /{t('week')}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}
