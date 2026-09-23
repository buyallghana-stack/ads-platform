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
  /** A hole cut around a real element, or a sheet that owns the screen. */
  kind: 'spotlight' | 'sheet'
  /** Where the member has to be standing. The driver takes them there. */
  route: string
  /** The `data-tour` value to cut the hole around. */
  anchor?: string
  /** Which side of the anchor the bubble prefers, space permitting. */
  place?: 'above' | 'below'
  /**
   * The step ends when the member DOES the thing rather than when they press
   * Next: the bubble drops its button and waits for the derived state to flip.
   */
  waits?: boolean
}

export const STEPS: Record<OnboardingStepKey, StepDescriptor> = {
  balance: { key: 'balance', kind: 'spotlight', route: '/dashboard', anchor: 'balance', place: 'below' },
  statement: { key: 'statement', kind: 'spotlight', route: '/dashboard', anchor: 'statement', place: 'above' },

  /* The activation moment. It waits, because "watched an ad" is the one thing
     in this sequence that cannot be faked by pressing Next, and the whole
     conversion sequence after it is built on it having really happened. */
  first_ad: { key: 'first_ad', kind: 'spotlight', route: '/ads', anchor: 'ad-card', place: 'below', waits: true },

  celebrate: { key: 'celebrate', kind: 'sheet', route: '/ads' },
  upgrade: { key: 'upgrade', kind: 'sheet', route: '/ads' },

  payout: { key: 'payout', kind: 'spotlight', route: '/profile/payout', anchor: 'payout-form', place: 'below', waits: true },
  pin: { key: 'pin', kind: 'spotlight', route: '/profile/pin', anchor: 'pin-form', place: 'below', waits: true },

  games: { key: 'games', kind: 'spotlight', route: '/dashboard', anchor: 'quick-links', place: 'above' },
  community: { key: 'community', kind: 'spotlight', route: '/profile', anchor: 'communities', place: 'above' },
  invite: { key: 'invite', kind: 'spotlight', route: '/team', anchor: 'invite', place: 'below' },
}

/** Every step, in the order the database gave, filtered to ones we can render. */
export function describe(key: OnboardingStepKey | null): StepDescriptor | null {
  return key ? (STEPS[key] ?? null) : null
}
