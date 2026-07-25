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
 * Ghanaian mobile numbers. Accepts local (0XX…) and international (+233XX…),
 * with spaces anywhere, since people type them both ways and rejecting a
 * correct number over a space is a bad first impression.
 *
 * Prefixes are the allocated ranges: MTN 24/54/55/59, Telecel 20/50,
 * AirtelTigo 26/27/56/57. Deliberately kept in step with the per-provider
 * patterns seeded in migration 017.
 */
const GHANA_PHONE = /^(?:\+233|0)(?:2[04679]|5[045679])\d{7}$/

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
})

export const logInSchema = z.object({
  email,
  password: z.string().min(1, 'passwordRequired'),
  rememberMe: z.boolean().optional(),
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
