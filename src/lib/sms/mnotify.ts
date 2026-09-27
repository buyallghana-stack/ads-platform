import 'server-only'

import { serverEnv } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'

/**
 * Sending an SMS through mNotify's BMS API v2.0 (https://developer.bms.africa).
 *
 * One endpoint is all this needs: `POST /api/sms/quick?key=...`. The gateway
 * only delivers; generating and checking codes is ours (`src/lib/auth/otp.ts`).
 *
 * `sms_type: "otp"` routes the message on mNotify's OTP lane and costs an
 * extra GHS 0.035 per campaign. Their docs warn it must only be set for OTP
 * blasts, so it is a flag on the call rather than a default.
 *
 * WITHOUT A KEY: in development the message is printed to the server log so
 * the flows can be walked locally. In production it fails loudly, because a
 * sign-in code that silently goes nowhere looks to a member exactly like the
 * app being broken.
 */

const ENDPOINT = 'https://api.mnotify.com/api/sms/quick'

export type SmsResult = { ok: true } | { ok: false; reason: 'notConfigured' | 'refused' | 'unreachable' }

export function smsConfigured(): boolean {
  const env = serverEnv()
  return Boolean(env.MNOTIFY_API_KEY && env.MNOTIFY_SENDER_ID)
}

export async function sendSms(input: { to: string; message: string; otp?: boolean }): Promise<SmsResult> {
  const env = serverEnv()

  if (!env.MNOTIFY_API_KEY || !env.MNOTIFY_SENDER_ID) {
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[sms:dev] to ${input.to}: ${input.message}`)
      return { ok: true }
    }
    reportUnexpected(new Error('MNOTIFY_API_KEY or MNOTIFY_SENDER_ID is not set'), 'sms.not-configured')
    return { ok: false, reason: 'notConfigured' }
  }

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(env.MNOTIFY_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        recipient: [input.to],
        sender: env.MNOTIFY_SENDER_ID,
        message: input.message,
        is_schedule: false,
        schedule_date: '',
        ...(input.otp ? { sms_type: 'otp' } : {}),
      }),
      // A member is watching a spinner. Better to say "try again" than hang.
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })

    const body = (await res.json().catch(() => null)) as {
      status?: string
      code?: string
      message?: string
      summary?: { total_rejected?: number }
    } | null

    // Success is `status: "success"` with code 2000, and the one recipient not
    // rejected. Anything else is logged with the gateway's own words (never
    // the message, which carries the code).
    if (res.ok && body?.status === 'success' && !(body.summary?.total_rejected ?? 0)) {
      return { ok: true }
    }
    reportUnexpected(new Error(`mNotify refused: ${body?.code ?? res.status} ${body?.message ?? ''}`), 'sms.refused')
    return { ok: false, reason: 'refused' }
  } catch (error) {
    reportUnexpected(error, 'sms.unreachable')
    return { ok: false, reason: 'unreachable' }
  }
}
