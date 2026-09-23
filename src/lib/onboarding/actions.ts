'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { ONBOARDING_STEPS, type OnboardingStepKey } from '@/lib/onboarding/types'
import { reportUnexpected } from '@/lib/observability/report'
import { createClient } from '@/lib/supabase/server'

/**
 * Advancing, stopping and replaying the walkthrough.
 *
 * All three go through the USER's client, not the service client, because all
 * three resolve the acting account from `auth.uid()` inside the database. That
 * is the point: there is no user id on the wire, so one account cannot advance
 * another's, and an admin part way through "view as user" cannot tick a
 * member's steps. The middleware refuses the POST during a look anyway, which
 * makes this the second of two locks rather than the only one.
 *
 * `getSessionUser()` is still called first, so a signed-out submission is
 * refused here rather than by an exception from Postgres.
 */

type NoArgCall = 'skip_onboarding' | 'replay_onboarding' | 'start_onboarding'

async function call(fn: NoArgCall | 'mark_onboarding_step', step?: OnboardingStepKey) {
  const user = await getSessionUser()
  if (!user) return { ok: false as const }

  const supabase = await createClient()
  const { error } =
    fn === 'mark_onboarding_step'
      ? await supabase.rpc(fn, { p_step: step as string })
      : await supabase.rpc(fn)

  if (error) {
    reportUnexpected(error, `onboarding.${fn}`, { step: step ?? null })
    return { ok: false as const }
  }

  /* Home carries the checklist and the layout carries the walkthrough itself,
     so both have to be rebuilt. Revalidating the layout's path covers every
     screen the spotlight can be standing on. */
  revalidatePath('/dashboard')
  revalidatePath('/', 'layout')
  return { ok: true as const }
}

export async function markOnboardingStep(step: OnboardingStepKey) {
  // Off a client callback, so it is checked rather than trusted.
  if (!ONBOARDING_STEPS.includes(step)) return { ok: false as const }
  return call('mark_onboarding_step', step)
}

/**
 * Begin the walkthrough.
 *
 * ⚠️ NOT `markOnboardingStep('balance')`, which is what the welcome sheet used
 * to call because it was the only way to create the row. It created the row
 * AND consumed step one, so a member who pressed "Show me around" landed on
 * step two having never been shown their balance. Starting is a fact about the
 * account, not about a step.
 */
export async function startOnboarding() {
  return call('start_onboarding')
}

export async function skipOnboarding() {
  return call('skip_onboarding')
}

export async function replayOnboarding() {
  return call('replay_onboarding')
}
