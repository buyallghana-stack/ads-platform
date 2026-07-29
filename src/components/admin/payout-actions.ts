import type { PayoutRequest, PayoutStatus } from '@/lib/admin/types'
import { needsEarlyApproval } from '@/lib/admin/types'

/**
 * What an operator may do to a payout, and what it costs them to do it.
 *
 * One module because the same rules drive three surfaces: the row's overflow
 * menu, the review panel's button bar, and the bulk bar. Deriving "can I
 * approve this?" in three places is three chances for the phone to offer an
 * action the tablet forbids.
 *
 * The `confirm` and `reason` flags are the safety model, and they are graded
 * rather than uniform — confirming everything trains an operator to click
 * through confirmations without reading them, which is worse than confirming
 * nothing:
 *
 *   approve   no confirmation. It is the happy path, it will be done dozens
 *             of times a day, and it does not move money — an approved
 *             payout is still sitting there until somebody marks it paid.
 *   hold      reason required. The user is told why in their notifications,
 *             and "your money is held" with no explanation is the single
 *             fastest way to earn a support ticket.
 *   decline   reason required, and confirmed. It ends the request.
 *   markPaid  confirmed. This is the irreversible one: it asserts the cash
 *             has actually left, and nothing downstream can un-assert it.
 *
 * `dispute` was removed on 2026-07-29 at the operator's request. A payout can
 * be held at any point before the money leaves — the user is told it is on
 * hold and why, and the chatbot carries it from there — which does everything
 * a dispute did and is reversible, where `disputed` was a terminal state with
 * no path out of it.
 */

export type PayoutAction = 'approve' | 'hold' | 'decline' | 'markPaid'

export const ACTION_RULES: Record<
  PayoutAction,
  {
    next: PayoutStatus
    /** Show a confirmation step before it happens. */
    confirm: boolean
    /** Require the operator to type a reason. */
    reason: boolean
    /** Renders red, and sits below the divider in the overflow menu. */
    destructive: boolean
  }
> = {
  approve: { next: 'approved', confirm: false, reason: false, destructive: false },
  hold: { next: 'held', confirm: false, reason: true, destructive: false },
  decline: { next: 'rejected', confirm: true, reason: true, destructive: true },
  markPaid: { next: 'paid', confirm: true, reason: false, destructive: false },
}

/**
 * The rule as it applies to THIS request, which is not always the flat one.
 *
 * Approve is normally the cheap, unconfirmed happy path. On a request that is
 * still held it is something else entirely — an override of a fraud control
 * that the database records as `approved_early`, stores a reason for, and
 * raises a system alert about. So it earns a reason box, and the caller must
 * ask for the rule with the request in hand rather than reading ACTION_RULES
 * directly.
 */
export function effectiveRule(action: PayoutAction, request: PayoutRequest) {
  const base = ACTION_RULES[action]
  if (action === 'approve' && needsEarlyApproval(request)) {
    return { ...base, confirm: true, reason: true }
  }
  return base
}

/**
 * The actions this request is entitled to, in the order they should appear.
 *
 * An action that cannot succeed is absent, never disabled. A greyed-out
 * button still occupies the row, still invites a click, and still has to be
 * read before it is dismissed — the operator asked for exactly this
 * behaviour.
 *
 * This took a `now` until 2026-07-29, because the dispute window was the one
 * thing whose availability depended on the clock. With disputes gone nothing
 * here is time-dependent, so the parameter went rather than sitting unused
 * and implying an expiry that no longer exists.
 */
export function availableActions(request: PayoutRequest): PayoutAction[] {
  switch (request.status) {
    case 'pending_approval':
      return ['approve', 'hold', 'decline']
    case 'held':
      // Already held; offering "hold" again would do nothing.
      return ['approve', 'decline']
    case 'approved':
      return ['markPaid', 'decline']
    case 'paid':
      // Nothing to do to a payout that has been sent. It is the end of the
      // line now that disputes are gone.
      return []
    default:
      return []
  }
}

/** The one action an operator most likely wants, for the bulk bar and the
 *  review panel's primary button. Null when the request needs no decision. */
export function primaryAction(request: PayoutRequest): PayoutAction | null {
  return availableActions(request)[0] ?? null
}

/**
 * Requests a bulk action can legally be applied to.
 *
 * A held request is deliberately NOT bulk-approvable even though approve is
 * one of its actions: overriding a fraud window demands a reason that is
 * recorded per request, and a checkbox cannot give one. Twenty windows waived
 * under a single click is precisely the thing the window exists to stop.
 */
export function bulkEligible(requests: PayoutRequest[], action: PayoutAction): PayoutRequest[] {
  return requests.filter(
    (r) =>
      availableActions(r).includes(action) &&
      !(action === 'approve' && needsEarlyApproval(r)),
  )
}
