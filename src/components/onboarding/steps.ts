import type { OnboardingStepKey } from '@/lib/onboarding/types'

/**
 * Where each step happens and what it points at.
 *
 * ANCHORED BY `data-tour`, NEVER BY A CSS SELECTOR. A class name is a styling
 * decision somebody is entitled to change; a `data-tour` attribute is a
 * declaration that this element is part of the walkthrough. Anchoring to
 * classes means a redesign silently leaves the spotlight pointing at nothing,
 * and nothing in the build would catch it.
 */

export type StepDescriptor = {
  key: OnboardingStepKey
  /**
   * `spotlight` dims the screen and cuts a hole. `task` dims nothing and
   * blocks nothing. `sheet` owns the screen.
   *
   * ⚠️ AN ACTION IS NEVER A SPOTLIGHT. A hole the size of one element cannot
   * hold a whole flow: watching an ad needs the tabs, the other cards and the
   * player; saving a payout account needs a form. Pointing a shade at one card
   * and waiting made those steps impossible to finish and the app look frozen.
   * If the step ends by the member DOING something, it is a `task`.
   */
  kind: 'spotlight' | 'task' | 'sheet'
  /** Where the member has to be standing. The driver takes them there. */
  route: string
  /** The `data-tour` value to cut the hole around. `spotlight` only. */
  anchor?: string
  /** Which side of the anchor the bubble prefers, space permitting. */
  place?: 'above' | 'below'
}

export const STEPS: Record<OnboardingStepKey, StepDescriptor> = {
  balance: { key: 'balance', kind: 'spotlight', route: '/dashboard', anchor: 'balance', place: 'below' },
  statement: { key: 'statement', kind: 'spotlight', route: '/dashboard', anchor: 'statement', place: 'above' },

  /* The activation moment, and the reason the task bar exists: the member
     needs the whole ads screen, including the surveys tab and the player. */
  first_ad: { key: 'first_ad', kind: 'task', route: '/ads' },

  celebrate: { key: 'celebrate', kind: 'sheet', route: '/ads' },

  payout: { key: 'payout', kind: 'task', route: '/profile/payout' },
  pin: { key: 'pin', kind: 'task', route: '/profile/pin' },

  games: { key: 'games', kind: 'spotlight', route: '/dashboard', anchor: 'quick-links', place: 'above' },
  community: { key: 'community', kind: 'spotlight', route: '/profile', anchor: 'communities', place: 'above' },
  invite: { key: 'invite', kind: 'spotlight', route: '/team', anchor: 'invite', place: 'below' },

  /* Last (operator, 2026-09-23). `route` is unused on a sheet and is left as
     the screen it sends people to, for readability only. */
  upgrade: { key: 'upgrade', kind: 'sheet', route: '/upgrade' },
}

/** Every step, in the order the database gave, filtered to ones we can render. */
export function describe(key: OnboardingStepKey | null): StepDescriptor | null {
  return key ? (STEPS[key] ?? null) : null
}
