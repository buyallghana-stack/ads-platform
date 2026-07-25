import type { PayoutRequest, PayoutStatus } from '@/lib/admin/types'
import { canDispute } from '@/lib/admin/types'

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
 *   dispute   reason required, and confirmed. It reopens a settled payment.
 */

export type PayoutAction = 'approve' | 'hold' | 'decline' | 'markPaid' | 'dispute'

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
  dispute: { next: 'disputed', confirm: true, reason: true, destructive: true },
}

/**
 * The actions this request is entitled to, in the order they should appear.
 *
 * An action that cannot succeed is absent, never disabled. A greyed-out
 * button still occupies the row, still invites a click, and still has to be
 * read before it is dismissed — see the dispute-window rule, where the
 * operator asked for exactly this behaviour.
 */
export function availableActions(request: PayoutRequest, now: number): PayoutAction[] {
  switch (request.status) {
    case 'pending_approval':
      return ['approve', 'hold', 'decline']
    case 'held':
      // Already held; offering "hold" again would do nothing.
      return ['approve', 'decline']
    case 'approved':
      return ['markPaid', 'decline']
    case 'paid':
      return canDispute(request, now) ? ['dispute'] : []
    default:
      return []
  }
}

/** The one action an operator most likely wants, for the bulk bar and the
 *  review panel's primary button. Null when the request needs no decision. */
export function primaryAction(request: PayoutRequest, now: number): PayoutAction | null {
  return availableActions(request, now)[0] ?? null
}

/** Requests a bulk action can legally be applied to. */
export function bulkEligible(
  requests: PayoutRequest[],
  action: PayoutAction,
  now: number,
): PayoutRequest[] {
  return requests.filter((r) => availableActions(r, now).includes(action))
}
