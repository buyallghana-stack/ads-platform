'use client'

import { useEffect, useState, useTransition } from 'react'

import { Celebration, UpgradeSheet, WelcomeSheet } from '@/components/onboarding/OnboardingSheets'
import { Spotlight } from '@/components/onboarding/Spotlight'
import { describe } from '@/components/onboarding/steps'
import { usePathname, useRouter } from '@/i18n/navigation'
import { markOnboardingStep, skipOnboarding } from '@/lib/onboarding/actions'
import type { UpgradePitch } from '@/lib/onboarding/data'
import type { OnboardingState } from '@/lib/onboarding/types'
import { useTranslations } from 'next-intl'

/**
 * The walkthrough driver. Mounted once, in the (app) layout, so a step can
 * point at something on any screen and survive the navigation between them.
 *
 * SEQUENTIAL MEANS SEQUENTIAL. The shades take every tap outside the lit
 * element, so there is no wandering off mid-flow, and the driver walks the
 * member to the step's screen rather than asking them to find it. The one way
 * out is the skip, which is always on the bubble: a walkthrough with no exit
 * is a trap, and the members who would have skipped it uninstall instead.
 *
 * ⚠️ THE STATE IS THE SERVER'S, AND IT IS RE-READ, NOT ADVANCED LOCALLY. Each
 * action returns through `revalidatePath`, so the next render carries the new
 * step. Keeping a local step counter here would let the client's idea of
 * progress drift from the database's, and the database's is the one that knows
 * whether the payout account actually exists.
 */
export function Onboarding({
  state,
  pitch,
  pointsPerCedi,
}: {
  state: OnboardingState
  pitch: UpgradePitch | null
  pointsPerCedi: number
}) {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  /* Locks the overlay out for the rest of this page's life the moment a skip
     is submitted, so the member is not looking at a dimmed screen while the
     server round trip and the revalidate finish. */
  const [dismissed, setDismissed] = useState(false)

  const step = describe(state.currentStep)
  const active = state.enabled && !state.skipped && !state.completed && !dismissed

  /*
    Walk them to the screen the step lives on.

    Guarded on `active` and on the route actually differing, because a push to
    the page you are already on is a re-render, and a re-render that re-runs
    this effect is a loop that pins the app.
  */
  useEffect(() => {
    if (!active || !state.started || !step) return
    if (pathname === step.route) return
    router.push(step.route)
  }, [active, state.started, step, pathname, router])

  if (!active) return null

  const index = state.doneCount + 1

  const advance = (key: string) => {
    start(async () => {
      await markOnboardingStep(key as Parameters<typeof markOnboardingStep>[0])
      router.refresh()
    })
  }

  const stop = () => {
    setDismissed(true)
    start(async () => {
      await skipOnboarding()
      router.refresh()
    })
  }

  /* Never started: the welcome sheet, once. */
  if (!state.started) {
    return (
      <WelcomeSheet
        onStart={() => advance('balance')}
        onSkip={stop}
      />
    )
  }

  if (!step) return null

  if (step.key === 'celebrate') {
    return (
      <Celebration
        points={state.adPoints}
        perCedi={pointsPerCedi}
        onNext={() => advance('celebrate')}
      />
    )
  }

  if (step.key === 'upgrade') {
    /* No sellable plan configured, so there is nothing to offer. Step past it
       rather than showing an empty sheet; the member should never see the
       consequence of an operator's plan table being mid-edit. */
    if (!pitch) {
      advance('upgrade')
      return null
    }
    return <UpgradeSheet pitch={pitch} onDecline={() => advance('upgrade')} />
  }

  /*
    A waiting step ends when the thing is true, so the bubble has no Next.
    `first_ad` is the exception to the exception: when nothing is servable the
    member cannot finish it however long they wait, so the button comes back
    and moves them on.
  */
  const stuck = step.key === 'first_ad' && state.firstAdBlocked
  const waits = Boolean(step.waits) && !stuck

  return (
    <Spotlight
      anchor={step.anchor!}
      place={step.place}
      title={stuck ? t('steps.first_ad.blockedTitle') : t(`steps.${step.key}.title`)}
      body={stuck ? t('steps.first_ad.blockedBody') : t(`steps.${step.key}.body`)}
      waiting={waits || pending}
      index={index}
      total={state.total}
      onNext={() => advance(step.key)}
      onSkip={stop}
    />
  )
}
