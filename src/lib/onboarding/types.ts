/**
 * The first-run walkthrough.
 *
 * The step KEYS are the contract between `onboarding_steps` in the database
 * and the descriptors in `@/components/onboarding/steps`. The operator may
 * reorder a step and switch one off from the admin; they may never rename one,
 * because the key is what both sides dispatch on.
 */

export const ONBOARDING_STEPS = [
  'balance',
  'statement',
  'first_ad',
  'celebrate',
  'upgrade',
  'payout',
  'pin',
  'games',
  'community',
  'invite',
] as const

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]

export type OnboardingState = {
  /** The master switch. Everything renders nothing when this is false. */
  enabled: boolean
  /** Whether they have a row yet, which is how "show the welcome sheet" is decided. */
  started: boolean
  /** They chose to stop. The spotlight never runs again on its own; the checklist stays. */
  skipped: boolean
  completed: boolean
  currentStep: OnboardingStepKey | null
  /**
   * `done` is the thing being TRUE, which is what the checklist ticks.
   * `walked` is the walkthrough having gone past it, which happens either
   * because they did it or because they said not now. Keeping them apart is
   * what lets somebody finish the tour without being told they have a payout
   * account they do not have.
   */
  steps: Array<{ key: OnboardingStepKey; done: boolean; walked: boolean }>
  total: number
  doneCount: number
  firstAdDone: boolean
  /**
   * Nothing is servable to this member right now.
   *
   * ⚠️ The one step nobody can satisfy by trying harder. Without this the
   * walkthrough traps a new member on step three whenever the ad pool runs
   * dry, which is worse than having no walkthrough at all.
   */
  firstAdBlocked: boolean
  /** Points earned from ads and surveys, for the congratulation's real number. */
  adPoints: number
  /** The peg. Read server-side because the key is private. */
  pointsPerCedi: number
}

/** What the client renders when the feature is off or the read failed. */
export const ONBOARDING_OFF: OnboardingState = {
  enabled: false,
  started: false,
  skipped: false,
  completed: true,
  currentStep: null,
  steps: [],
  total: 0,
  doneCount: 0,
  firstAdDone: false,
  firstAdBlocked: false,
  adPoints: 0,
  pointsPerCedi: 100,
}
