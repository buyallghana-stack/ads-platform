import 'server-only'

import * as Sentry from '@sentry/nextjs'

/**
 * Report something that was NOT supposed to happen.
 *
 * WHY THIS EXISTS AT ALL. Sentry's own rule is "if you catch an error and
 * don't re-throw it, Sentry never sees it" — and this application catches
 * almost everything on purpose, because a person mid-withdrawal deserves a
 * sentence rather than a stack trace. Verified against the live project:
 * server COMPONENT render errors arrive automatically, and a throw inside a
 * ROUTE HANDLER does not arrive at all, because Next catches it and answers
 * 500 before any uncaught handler runs. So every deliberate catch on a money
 * path was invisible, which is the opposite of what error tracking is for.
 *
 * THE LINE THIS DRAWS, and it is the whole point:
 *
 *   REPORT the unexpected — a database that would not answer, a provider that
 *   returned nonsense, a function that raised something we have no branch for.
 *
 *   NEVER report the expected — a wrong PIN, an insufficient balance, an email
 *   already registered, a link clicked twice. Those are the system working.
 *   A tracker that cries about them teaches its owner to ignore it, and an
 *   ignored tracker is worse than none.
 *
 * So this is called from the `catch` that has run out of explanations, never
 * from the branch that has one.
 *
 * It is best-effort by construction: reporting a failure must never become a
 * second failure, so nothing here throws and nothing here is awaited by the
 * caller's happy path.
 */
export function reportUnexpected(
  error: unknown,
  /** Where it happened, in words a person scanning the issue list can use —
   *  'withdraw.request', 'paystack.webhook', 'cron.purge-deletions'. */
  where: string,
  /** Anything that helps without identifying anybody. Never a token, a PIN, a
   *  phone number or a wallet address. */
  extra?: Record<string, string | number | boolean | null>,
): void {
  try {
    Sentry.captureException(error, {
      tags: { where },
      extra,
    })
  } catch {
    // Sentry is not configured, or is unreachable. Not worth a second word.
  }
}
