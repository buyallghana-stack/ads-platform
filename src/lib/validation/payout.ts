import { z } from 'zod'

/**
 * Client-side payout-detail shape. Deliberately LIGHT: the real validation —
 * provider/coin/network activity, phone-number and wallet-address patterns —
 * lives in the `set_payout_details` database function, which is the boundary.
 * These checks only stop an empty or obviously wrong form before it round
 * trips. Error strings are translation keys.
 */
export const momoSchema = z.object({
  method: z.literal('mobile_money'),
  providerId: z.string().uuid('providerRequired'),
  msisdn: z.string().trim().min(1, 'numberRequired'),
  accountName: z.string().trim().min(2, 'nameRequired'),
})

export const cryptoSchema = z.object({
  method: z.literal('crypto'),
  coinId: z.string().uuid('coinRequired'),
  networkId: z.string().uuid().nullable().optional(),
  walletAddress: z.string().trim().min(1, 'walletRequired'),
})

export const payoutSchema = z.discriminatedUnion('method', [momoSchema, cryptoSchema])

export type MomoInput = z.infer<typeof momoSchema>
export type CryptoInput = z.infer<typeof cryptoSchema>
export type PayoutInput = z.infer<typeof payoutSchema>
