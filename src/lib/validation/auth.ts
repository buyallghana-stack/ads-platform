import { z } from 'zod'

import { isPasswordAcceptable } from '@/lib/password'

/**
 * Auth form schemas.
 *
 * Error messages are translation KEYS, not sentences. The form resolves them
 * against the active locale, so no user-facing string is hardcoded here (§3).
 *
 * These same schemas run on the server. The client copy is convenience; the
 * server copy is the boundary (§2.4).
 */

/**
 * Ghanaian mobile numbers: starts 02 or 05, ten digits. Local (0XX…) and
 * international (+233XX…) both accepted, with spaces or dashes anywhere,
 * since people type them every way and rejecting a correct number over a
 * space is a bad first impression.
 *
 * DELIBERATELY NOT AN ALLOW-LIST OF NETWORK PREFIXES. It used to be
 * `2[04679]|5[045679]`, matching the ranges allocated to MTN, Telecel and
 * AirtelTigo — which refused a genuine 021, 023, 025, 028, 051, 052, 053 or
 * 058 number, went stale the moment the NCA allocated a new range, and cost
 * the operator their own signup. The shape of the number is worth checking;
 * which network issued it is not ours to decide.
 *
 * The +233 form is the same number without its leading zero, so the digit
 * count after the prefix is identical and one pattern covers both.
 */
const GHANA_PHONE = /^(?:\+233|0)[25]\d{8}$/

const phone = z
  .string()
  .min(1, 'phoneRequired')
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => GHANA_PHONE.test(v), 'phoneInvalid')

const email = z.string().min(1, 'emailRequired').pipe(z.email('emailInvalid'))

const password = z
  .string()
  .min(1, 'passwordRequired')
  .refine(isPasswordAcceptable, 'passwordTooWeak')

export const signUpSchema = z.object({
  fullName: z
    .string()
    .min(1, 'fullNameRequired')
    .transform((v) => v.trim())
    .refine((v) => v.length >= 2, 'fullNameTooShort'),
  email,
  phone,
  password,
  // Optional, but must be well-formed when present. The alphabet matches
  // generate_referral_code() in migration 001: Crockford-style, no I/L/O/U.
  referralCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(v), 'referralInvalid')
    .optional(),
  acceptTerms: z.literal(true, { message: 'termsRequired' }),
  /*
    The device fingerprint, taken in the browser. OPTIONAL and always will be:
    privacy browsers break the APIs it needs on purpose, and a fraud control
    that stops a real person registering costs more than it saves. Absent
    simply means the device checks cannot speak for this signup.

    Bounded because it is attacker-supplied, like every other field here — it
    is a hash on the way in and nothing downstream treats it as trusted.
  */
  fingerprint: z.string().trim().max(128).optional(),
  /** Cloudflare Turnstile token. Only required when the operator has set
   *  keys — see `turnstile.ts`; the server decides, not this schema. */
  turnstileToken: z.string().max(4096).optional(),
})

export const logInSchema = z.object({
  email,
  password: z.string().min(1, 'passwordRequired'),
  rememberMe: z.boolean().optional(),
  /** See the note on signUpSchema. Recorded against the sign-in signal so a
   *  device that collects accounts is visible even when each one was made
   *  somewhere else. */
  fingerprint: z.string().trim().max(128).optional(),
})

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string().min(1, 'passwordRequired'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  })

export type SignUpInput = z.input<typeof signUpSchema>
export type LogInInput = z.input<typeof logInSchema>
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>
