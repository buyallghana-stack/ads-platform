import { z } from 'zod'

/**
 * Personal details a user may edit freely (name, phone). Error strings are
 * translation KEYS resolved by the caller, never user-facing text (§3).
 *
 * Phone is optional and intentionally lenient — it is contact info, not the
 * payout MSISDN (that has its own strict validation in the payout flow). An
 * empty string clears it.
 */
export const personalSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'nameTooShort')
    .max(80, 'nameTooLong'),
  phone: z
    .string()
    .trim()
    .max(20, 'phoneTooLong')
    .regex(/^[+()\d\s-]+$/, 'phoneInvalid')
    .optional()
    .or(z.literal('')),
})

export type PersonalInput = z.infer<typeof personalSchema>
