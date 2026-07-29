'use client'

/**
 * The device fingerprint, taken in the browser and sent with signup and
 * sign-in.
 *
 * WHAT IT IS FOR, AND THE ONLY THING IT IS FOR
 * Three of the nine checks in `fraud_checks` are about a DEVICE rather than an
 * account — `device_multi_account` (weight 30), `self_referral_suspected`
 * (35), and the device half of a rapid-redemption pattern. Every one of them
 * has been inert since the fraud layer was built, because
 * `evaluate_signup_fraud` and `apply_referral_code` take a `p_fingerprint` and
 * the app has always passed `undefined`. On a watch-to-earn platform, one
 * person running ten accounts is the fraud, and payouts are now enabled.
 *
 * WHAT IT IS NOT. It is not an identifier we attach to a person, show anybody,
 * or use for anything but these checks. It is a hash of coarse browser
 * characteristics, it is stored on `fraud_signals` and `auth_signals`, and it
 * is described in the privacy policy in those terms.
 *
 * IT MUST NEVER BLOCK A SIGNUP. Fingerprinting runs in the browser, depends on
 * canvas and font APIs that privacy browsers deliberately break, and can be
 * slow on a cheap Android. So every path here fails to `undefined`, which is
 * exactly what the server already handles — the account is created and simply
 * carries no device signal, which is the same position we were in before this
 * existed. A fraud control that can lock a real user out of registering has
 * cost more than it saves.
 */

/**
 * How long to wait before giving up and continuing without one.
 *
 * Measured at roughly 1s on a desktop Chromium against a real origin, so 2.5s
 * is about twice the observed cost — enough headroom for a cheap Android
 * without making anybody watch a spinner if something hangs.
 */
const TIMEOUT_MS = 2500

/**
 * Measured behaviour of this library, verified rather than assumed:
 *   · no network calls at all without an API key — nothing about the user
 *     leaves the browser except the hash we ourselves send;
 *   · the same hash across fresh browser contexts on one device;
 *   · a different hash for a different device profile;
 *   · an EMPTY STRING on a page with no real origin (about:blank), which is
 *     why "" is treated as "no fingerprint" below rather than stored as one.
 */
/**
 * The work, started at most once per page session.
 *
 * The PROMISE is cached rather than the value, so a second caller joins the
 * first attempt instead of starting its own — and so `warmFingerprint` below
 * has something to start early.
 */
let inFlight: Promise<string | undefined> | null = null

async function compute(): Promise<string | undefined> {
  try {
    const result = await Promise.race([
      import('@thumbmarkjs/thumbmarkjs').then((m) => m.getFingerprint()),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), TIMEOUT_MS)),
    ])

    return typeof result === 'string' && result.length > 0 ? result : undefined
  } catch {
    // Blocked, unsupported, or offline. Not an error worth surfacing.
    return undefined
  }
}

export function deviceFingerprint(): Promise<string | undefined> {
  if (typeof window === 'undefined') return Promise.resolve(undefined)

  // Two forms in one visit (a failed login then a signup, say) must agree, and
  // a second's work is not free on a low-end device.
  if (!inFlight) inFlight = compute()
  return inFlight
}

/**
 * Start the work while the user is still typing.
 *
 * The library is a separate chunk of about 12 KB gzipped and is not fetched
 * until something asks for a fingerprint. Left to the submit handler, that
 * download sits in front of the login request on exactly the connections
 * least able to afford it. Called from the auth forms on mount, it happens
 * during the seconds somebody spends filling the form instead.
 *
 * Deliberately returns nothing: this is a hint, never something to await.
 */
export function warmFingerprint(): void {
  void deviceFingerprint()
}
