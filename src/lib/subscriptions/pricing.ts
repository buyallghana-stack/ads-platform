import type { Plan } from './data'

/**
 * What an amount buys, worked out the same way the database works it out.
 *
 * THE SAME ARITHMETIC IN TWO PLACES, DELIBERATELY. `plan_multiplier_for_amount`
 * in Postgres is the authority — it is what actually decides what an ad pays.
 * This is what the slider shows while somebody drags it, and a round trip per
 * pixel is not an option on a Ghanaian connection. So the rule is written
 * twice and must stay identical; the tests check one against the other rather
 * than trusting that they agree.
 */

/** The multiplier bought by `amountMinor`, interpolated inside the plan's band. */
export function multiplierForAmount(plan: Plan, amountMinor: number): number {
  const floor = plan.bandMinMinor
  const ceiling = plan.bandMaxMinor
  const amount = Math.min(Math.max(amountMinor, floor), ceiling)

  // A single price with nothing above it: no line to walk.
  if (ceiling <= floor) return plan.rewardMultiplier

  /* THE SPAN IS TO WHERE THE LINE ENDS, NOT TO THE TOP OF THE BAND, and those
     are one pesewa apart between rungs: the band stops just below the next
     plan's price, so paying the very top of it earns just under the next
     plan's rate and the bands meet without a step.

     On the top plan the two coincide — its ceiling IS the end of its line,
     because there is no rung above to hand off to — so paying GHS 1,000 for
     Platinum earns exactly the ×7 the card promises rather than a hair under
     it. Writing this as `ceiling + 1 - floor`, as it was before the top plan
     had a band, would quietly shave that last pesewa's worth off. */
  const span = plan.lineEndMinor - floor
  if (span <= 0) return plan.rewardMultiplier
  const share = (amount - floor) / span
  const exact = plan.rewardMultiplier + (plan.nextMultiplier - plan.rewardMultiplier) * share

  /*
    ROUNDED TO THREE DECIMALS, because `plan_multiplier_for_amount` rounds to
    three decimals and the database is the one that actually pays. Keeping full
    precision here is not "more accurate", it is a different answer: at GHS 293
    the exact value is 2.57963, which floors to 257 points, while the database
    stores 2.580 and pays 258. The screen would have quoted one point less than
    the user received on every ad — small, permanent, and exactly the kind of
    drift two implementations of one rule produce.
  */
  return Math.round(exact * 1000) / 1000
}

/** Points one ad pays at this multiplier, rounded the way the database rounds. */
export function pointsPerAd(baseAdPoints: number, multiplier: number): number {
  return Math.max(Math.floor(baseAdPoints * multiplier), 1)
}
