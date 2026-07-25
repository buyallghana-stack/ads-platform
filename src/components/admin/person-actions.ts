import type { Person } from '@/lib/admin/types'

/**
 * What an operator may do to an account, and what it costs them to do it.
 *
 * Same shape and same reasoning as payout-actions: one module, so the card's
 * overflow menu and the review panel's button bar can never disagree about
 * whether an account can be disabled. See that file for why `confirm` and
 * `reason` are graded rather than applied to everything.
 *
 * The grading here:
 *   flag      reason required. A flag is a note to the next operator; a flag
 *             with no reason is a account somebody will have to re-investigate
 *             from scratch.
 *   clear     no confirmation. It is the undo, and undo should be cheap.
 *   disable   reason required, and confirmed. It stops the person earning and
 *             stops them withdrawing — the harshest thing on this screen.
 *   enable    no confirmation, for the same reason as clear.
 */

export type PersonAction = 'flag' | 'clear' | 'disable' | 'enable'

export const PERSON_RULES: Record<
  PersonAction,
  { next: Person['status']; confirm: boolean; reason: boolean; destructive: boolean }
> = {
  flag: { next: 'flagged', confirm: false, reason: true, destructive: false },
  clear: { next: 'active', confirm: false, reason: false, destructive: false },
  disable: { next: 'disabled', confirm: true, reason: true, destructive: true },
  enable: { next: 'active', confirm: false, reason: false, destructive: false },
}

/**
 * The actions this account is entitled to, in the order they should appear.
 * An action that cannot succeed is absent, never disabled — the same rule the
 * payout queue follows.
 */
export function personActions(person: Person): PersonAction[] {
  switch (person.status) {
    case 'active':
      return ['flag', 'disable']
    case 'flagged':
      // Clearing first: an operator opening a flagged account is usually
      // there to decide it was fine, not to escalate.
      return ['clear', 'disable']
    case 'disabled':
      return ['enable']
  }
}
