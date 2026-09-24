import { describe, expect, it } from 'vitest'

import { ONBOARDING_OFF, showsChecklist, type OnboardingState } from '@/lib/onboarding/types'

/**
 * When Home shows the "Set up your earning" checklist.
 *
 * Operator, 2026-09-24: only while a walkthrough is running. A skip hides it
 * until the member replays from Profile, and the end of any run, finished or
 * skipped, first or replayed, hides it again. Pure, so no database needed:
 * the states below are the ones get_onboarding_state returns at each moment.
 */

const running: OnboardingState = {
  ...ONBOARDING_OFF,
  enabled: true,
  started: true,
  skipped: false,
  completed: false,
  currentStep: 'payout',
  steps: [
    { key: 'balance', done: true, walked: true },
    { key: 'payout', done: false, walked: false },
  ],
  total: 2,
}

describe('onboarding checklist visibility', () => {
  it('shows while a walkthrough is running', () => {
    expect(showsChecklist(running)).toBe(true)
  })

  it('does not show to a new member who has not answered the welcome sheet', () => {
    expect(showsChecklist({ ...running, started: false })).toBe(false)
  })

  it('hides after a skip, even with steps still to do', () => {
    expect(showsChecklist({ ...running, skipped: true })).toBe(false)
  })

  it('comes back for a replay, which clears the skip', () => {
    /* replay_onboarding sets skipped_at and seen_steps back to empty. */
    const replayed = { ...running, skipped: false, completed: false }
    expect(showsChecklist(replayed)).toBe(true)
  })

  it('hides the moment a run ends, even if a step was only said "later" to', () => {
    /* completed = every step walked, not every step done: the payout account
       still does not exist, and the list stays hidden anyway. */
    const ended: OnboardingState = {
      ...running,
      completed: true,
      currentStep: null,
      steps: [
        { key: 'balance', done: true, walked: true },
        { key: 'payout', done: false, walked: true },
      ],
    }
    expect(showsChecklist(ended)).toBe(false)
  })

  it('hides when the walkthrough is switched off', () => {
    expect(showsChecklist({ ...running, enabled: false })).toBe(false)
    expect(showsChecklist(ONBOARDING_OFF)).toBe(false)
  })
})
