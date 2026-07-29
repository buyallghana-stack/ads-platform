import 'server-only'

/**
 * WHAT IS LEFT OF THE ADMIN PREVIEW LAYER: one boolean.
 *
 * The operator asked for the admin UI first and the backend after, so every
 * screen once rendered from this module and nothing else. That was a
 * deliberate seam, not a shortcut: each function returned the exact shape the
 * real query would have to return, so wiring a screen later was replacing one
 * call rather than rewriting a component. It held for all twelve — payouts,
 * config, ads, users, flagged, the audit log, advertisers, finance, the
 * overview, subscriptions, admin settings, and now messages — none of which
 * needed a component change to cross it.
 *
 * EVERY GENERATOR IS NOW DELETED, including `people`, which was the last one
 * and belonged to Messages. An unused source of invented money figures is an
 * invitation to import it back by accident, and these were money figures.
 *
 * `PREVIEW` stays because it is the switch that would put the amber badge
 * back on any NEW screen built ahead of its backend. Nothing renders it today
 * — every route is in REAL_ADMIN_SECTIONS, so every route shows "Live data" —
 * and "no badge" must never come to mean both things.
 */

export const PREVIEW = true
