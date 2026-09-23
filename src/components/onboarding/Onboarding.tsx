'use client'

import { useEffect, useState, useTransition } from 'react'

import { Celebration, UpgradeSheet, WelcomeSheet } from '@/components/onboarding/OnboardingSheets'
import { Spotlight } from '@/components/onboarding/Spotlight'
import { TaskBar } from '@/components/onboarding/TaskBar'
import { describe } from '@/components/onboarding/steps'
import { usePathname, useRouter } from '@/i18n/navigation'
import { markOnboardingStep, skipOnboarding } from '@/lib/onboarding/actions'
import type { UpgradeOffer } from '@/lib/onboarding/data'
import type { OnboardingState } from '@/lib/onboarding/types'
import { useTranslations } from 'next-intl'

/**
 * The walkthrough driver. Mounted once, in the (app) layout, so a step can
 * point at something on any screen and survive the navigation between them.
 *
 * SEQUENTIAL, BUT NOT THE SAME WAY FOR EVERY STEP. The driver walks the member
 * to the screen a step lives on, and the step decides how firmly it holds
 * them:
 *
 *   spotlight  explaining something. The screen dims, one element is lit, and
 *              taps outside it are absorbed. Nothing is being asked for, so
 *              there is nothing to get in the way of.
 *   task       asking for something. Dims nothing, blocks nothing. The member
 *              needs the whole screen to watch an ad or fill in a form, and
 *              the bar clears itself when the database says it is done.
 *   sheet      a moment worth the whole screen: the welcome, the
 *              congratulation, the offer.
 *
 * ⚠️ THE ORIGINAL BUILD USED A SPOTLIGHT FOR EVERYTHING, and it made the
 * action steps impossible to finish: the shade around one ad card swallowed
 * taps on the surveys tab, on every other card and on the player itself, so
 * the step waited for ever and the app read as frozen.
 *
 * Skip is on every one of them. A walkthrough with no exit is a trap, and the
 * members who would have skipped it uninstall instead.
 *
 * ⚠️ THE STATE IS THE SERVER'S, AND IT IS RE-READ, NOT ADVANCED LOCALLY. Each
 * action returns through `revalidatePath`, so the next render carries the new
 * step. Keeping a local step counter here would let the client's idea of
 * progress drift from the database's, and the database's is the one that knows
 * whether the payout account actually exists.
 */
export function Onboarding({
  state,
  offer,
  pointsPerCedi,
}: {
  state: OnboardingState
  offer: UpgradeOffer | null
  pointsPerCedi: number
}) {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const pathname = usePathname()
  /*
    ⚠️ `pending` DELIBERATELY DOES NOT REACH A BUTTON, and this was the bug the
    operator kept hitting. `useTransition` stays pending for the WHOLE round
    trip: the RPC, the revalidate of the app shell, and the refresh. On a
    Ghanaian mobile connection that is seconds.

    The optimistic advance meant the next step appeared at once, and then its
    Next button was handed that same pending flag, so it rendered DISABLED with
    a spinner for those seconds. Pressing it did nothing. Reported as an
    unresponsive, laggy card and as being stuck on step 2, and the optimism
    made it worse rather than better, because now you could see the step you
    were not allowed to leave.

    The walkthrough has already moved on by the time the write lands, so there
    is nothing for a member to wait for and nothing to disable.
  */
  const [, start] = useTransition()

  /* Locks the overlay out for the rest of this page's life the moment a skip
     is submitted, so the member is not looking at a dimmed screen while the
     server round trip and the revalidate finish. */
  const [dismissed, setDismissed] = useState(false)

  /*
    ── THE TAP LANDS NOW, THE SERVER CATCHES UP ──────────────────────────────

    ⚠️ Advancing is a round trip: an RPC, a revalidate of the whole app shell,
    and a refresh. On a Ghanaian mobile connection that is seconds, and for all
    of them the card sat there with a disabled button. Reported as laggy and
    unresponsive, and as being stuck on a step.

    So a pressed step is remembered here immediately and the walkthrough moves
    on at once. The server is still the authority: when its state arrives, any
    step it agrees has been walked drops out of this list, and anything it
    disagrees about comes back. Nothing here can tick a checklist row, because
    that is read from the real tables and never from this.
  */
  const [pressed, setPressed] = useState<string[]>([])

  /* Anything the server has caught up on is dropped here at render rather than
     in an effect: there is nothing to synchronise, only a list to read past,
     and a setState in an effect is a cascading render for no reason. */
  const awaitingServer = pressed.filter(
    (key) => !state.steps.some((s) => s.key === key && s.walked),
  )

  const current =
    state.steps.find((s) => !s.walked && !awaitingServer.includes(s.key))?.key ??
    state.currentStep

  const step = describe(current)
  const active = state.enabled && !state.skipped && !state.completed && !dismissed

  /*
    Walk them to the screen the step lives on.

    ⚠️ A SHEET STEP NEVER NAVIGATES, AND THIS IS NOT A TIDINESS RULE. The offer
    used to carry `route: '/ads'`, so the moment its "See Bronze" link reached
    /upgrade this effect saw a mismatch and threw the member straight back. The
    plans were unreachable and the button read as dead. A sheet covers the
    whole viewport, so whatever is behind it is irrelevant; anything that
    leaves the walkthrough ends the step on its way out instead.
  */
  useEffect(() => {
    if (!active || !state.started || !step) return
    if (step.kind === 'sheet') return
    if (pathname === step.route) return
    router.push(step.route)
  }, [active, state.started, step, pathname, router])

  if (!active) return null

  /*
    ⚠️ THE POSITION, NOT THE DONE COUNT. "Step 5 of 10" was showing on the
    fourth screen, because a derived step ticks the moment its fact is true and
    the count then runs ahead of where the member actually is. The label has to
    describe the walk, so it counts the step's place in the list.
  */
  const index = Math.max(state.steps.findIndex((s) => s.key === current) + 1, 1)

  const advance = (key: string) => {
    /* Moves the walkthrough on this frame. The write follows. */
    setPressed((prev) => (prev.includes(key) ? prev : [...prev, key]))
    start(async () => {
      const result = await markOnboardingStep(key as Parameters<typeof markOnboardingStep>[0])
      /* It did not save, so put the member back where they were rather than
         letting them walk on from a step the server never recorded. */
      if (!result.ok) setPressed((prev) => prev.filter((k) => k !== key))
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
    if (!offer) {
      advance('upgrade')
      return null
    }
    return (
      <UpgradeSheet
        offer={offer}
        /* Finish the step FIRST, then go. Navigating while `upgrade` is still
           the current step is what made the button look dead. The chosen plan
           rides along so the Upgrade screen opens on it rather than at the top
           of a list they have just scrolled through. */
        onChoose={(slug) =>
          start(async () => {
            await markOnboardingStep('upgrade')
            router.push(`/upgrade?plan=${slug}`)
            router.refresh()
          })
        }
        onDecline={() => advance('upgrade')}
      />
    )
  }

  /*
    An ACTION step. Nothing is dimmed and nothing is blocked: the member needs
    the real screen to do the real thing, and the bar goes away on its own when
    the database says it is done.

    `first_ad` is the one step nobody can finish by trying harder, so when the
    pool is empty the bar says so and offers a way past. The other two are
    always finishable, so they only offer Skip.
  */
  if (step.kind === 'task') {
    const stuck = step.key === 'first_ad' && state.firstAdBlocked
    return (
      <TaskBar
        title={stuck ? t('steps.first_ad.blockedTitle') : t(`steps.${step.key}.title`)}
        body={stuck ? t('steps.first_ad.blockedBody') : t(`steps.${step.key}.body`)}
        index={index}
        total={state.total}
        /* ⚠️ ALWAYS OFFERED, on every task step. It used to appear only when
           the ad pool was empty, so the only way past "add a payout account"
           was Skip, and Skip ends the whole walkthrough. "Not right now" is an
           ordinary thing to want and it should not cost the remaining five
           steps. Saying not now moves the walkthrough on; it does NOT tick the
           checklist, because the account still does not exist. */
        onNext={() => advance(step.key)}
        onSkip={stop}
      />
    )
  }

  return (
    <Spotlight
      anchor={step.anchor!}
      title={t(`steps.${step.key}.title`)}
      body={t(`steps.${step.key}.body`)}
      index={index}
      total={state.total}
      onNext={() => advance(step.key)}
      onSkip={stop}
    />
  )
}
