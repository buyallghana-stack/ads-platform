import { z } from 'zod'

/**
 * Environment validation.
 *
 * Parsed once at module load so a missing or malformed variable fails fast at
 * boot with a readable message, rather than surfacing as `undefined` deep in a
 * request — which on this platform could mean a payout path silently
 * misbehaving. Money-critical config does not get to be optional.
 *
 * Client and server vars are split deliberately: Next.js only inlines
 * `NEXT_PUBLIC_*` into the browser bundle, so referencing a server-only key
 * from a client component must break at build time, not leak at runtime.
 */

/** Coerce "true"/"false" strings from .env into real booleans. */
const envBool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true')

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    message: 'NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://xxx.supabase.co',
  }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required'),
  NEXT_PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
})

const serverSchema = z.object({
  /**
   * Bypasses RLS. Optional at this stage so the app boots before the operator
   * has copied it in; every consumer must assert its presence at point of use
   * (see `requireSecretKey`).
   */
  SUPABASE_SECRET_KEY: z.string().optional(),

  /**
   * §2.3 — license gate. Points accrue and display a currency value regardless;
   * this flag governs only the final disbursement of real money. Defaults to
   * OFF so that forgetting to set it can never move funds.
   */
  PAYOUTS_ENABLED: envBool(false),

  /**
   * §6.9 — Ghana-only enforcement. Defaults to OFF so local development works
   * from anywhere. Production must set this true; the pre-production
   * checklist (§10) verifies it.
   */
  GEO_RESTRICTION_ENABLED: envBool(false),
})

/**
 * `NEXT_PUBLIC_*` vars must be referenced as full literal property accesses so
 * the Next.js compiler can statically inline them. Building the object
 * dynamically (e.g. from `process.env` by key) yields `undefined` in the
 * browser bundle.
 */
const parsedClient = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
})

if (!parsedClient.success) {
  throw new Error(
    `Invalid public environment variables:\n${z.prettifyError(parsedClient.error)}\n\n` +
      `Copy .env.example to .env.local and fill in the values.`,
  )
}

export const clientEnv = parsedClient.data

/**
 * Server-only environment.
 *
 * Lazily parsed and memoised: this module is imported by client components via
 * `clientEnv`, and eagerly reading server vars there would validate against an
 * empty `process.env` in the browser.
 */
let serverEnvCache: z.infer<typeof serverSchema> | null = null

export function serverEnv(): z.infer<typeof serverSchema> {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() was called in the browser. Server config must never reach the client.')
  }

  if (serverEnvCache) return serverEnvCache

  const parsed = serverSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || undefined,
    PAYOUTS_ENABLED: process.env.PAYOUTS_ENABLED,
    GEO_RESTRICTION_ENABLED: process.env.GEO_RESTRICTION_ENABLED,
  })

  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${z.prettifyError(parsed.error)}`)
  }

  serverEnvCache = parsed.data
  return serverEnvCache
}

/**
 * Asserts the RLS-bypassing secret key is configured. Call this at the point of
 * use so the failure names the feature that needs it.
 */
export function requireSecretKey(): string {
  const key = serverEnv().SUPABASE_SECRET_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SECRET_KEY is not set. Copy it from the Supabase dashboard ' +
        '(Project Settings > API Keys > secret key) into .env.local.',
    )
  }
  return key
}
