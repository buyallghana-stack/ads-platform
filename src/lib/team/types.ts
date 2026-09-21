/**
 * Shapes for the Team screen. No server imports — `data.ts` is `server-only`
 * and the view that renders these is a client component.
 *
 * EVERY MONEY FIGURE HERE IS CEDIS, never points. That is the operator's
 * instruction, relayed from their lawyer, and it is the reason the whole
 * screen exists: a team's activity is being reported to somebody as evidence,
 * and points are not a unit anybody can check.
 */

export const TEAM_SCOPES = ['all', 'level1', 'level2'] as const
export type TeamScope = (typeof TEAM_SCOPES)[number]

/** 1 = people they invited. 2 = the people those people invited. No 3. */
export type TeamLevel = 1 | 2

export type TeamTotals = {
  people: number
  plansBought: number
  /** What those plans cost, in cedis. */
  plansValue: number
  /** Paid out to them, in cedis. Requested-but-unpaid is not withdrawn. */
  redeemed: number
  /** What their remaining points are worth, in cedis. */
  remaining: number
}

export type TeamMember = {
  level: TeamLevel
  id: string
  name: string | null
  /** Null when they never gave one, or when the operator has switched the
   *  column off with `team_shows_member_phone`. */
  phone: string | null
  joinedAt: string
  /** The highest plan they hold right now. Never null: no plans means the
   *  default tier, which is a standing rather than an absence. */
  topPlan: string
  /** How many plans they hold beyond the top one — the "+2" in "Platinum + 2". */
  extraPlans: number
  plansBought: number
  plansValue: number
  redeemed: number
  remaining: number
}

export type TeamData = {
  /** Their own invite code, so the screen is not a dead end when empty. */
  code: string | null
  byLevel: Record<TeamLevel, TeamTotals>
  members: TeamMember[]
}

export const EMPTY_TOTALS: TeamTotals = {
  people: 0,
  plansBought: 0,
  plansValue: 0,
  redeemed: 0,
  remaining: 0,
}

/** Adds two levels together for the All scope. */
export function addTotals(a: TeamTotals, b: TeamTotals): TeamTotals {
  return {
    people: a.people + b.people,
    plansBought: a.plansBought + b.plansBought,
    plansValue: a.plansValue + b.plansValue,
    redeemed: a.redeemed + b.redeemed,
    remaining: a.remaining + b.remaining,
  }
}

export function totalsFor(data: TeamData, scope: TeamScope): TeamTotals {
  if (scope === 'level1') return data.byLevel[1]
  if (scope === 'level2') return data.byLevel[2]
  return addTotals(data.byLevel[1], data.byLevel[2])
}

export function membersFor(data: TeamData, scope: TeamScope): TeamMember[] {
  if (scope === 'all') return data.members
  const level = scope === 'level1' ? 1 : 2
  return data.members.filter((m) => m.level === level)
}
