import 'server-only'

import { createHmac, randomInt } from 'node:crypto'

import { requireSecretKey } from '@/lib/env'
import { reportUnexpected } from '@/lib/observability/report'
import { getRequestContext } from '@/lib/request-context'
import { sendSms } from '@/lib/sms/mnotify'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * SMS codes: issued here, stored as an HMAC, checked by the database.
 *
 * The limits (lifetime, resend cooldown, hourly cap per number, five tries)
 * are enforced inside `otp_issue` and `otp_check` under a lock, so two quick
 * taps or two tabs cannot slip past them. The first three are `app_config`
 * rows the operator can change; see migration 20260902000000.
 *
 * The HMAC key is the service key, which the database never holds, so a copy
 * of `phone_otps` is useless for guessing codes. Rotating it only voids codes
 * already in flight, which live ten minutes.
 */

export type OtpPurpose = 'signup' | 'verify_phone' | 'reset_password' | 'change_password' | 'change_phone'

export type OtpIssueResult =
  | { ok: true; resendSeconds: number }
  | { ok: false; reason: 'cooldown' | 'limit'; retryAfter: string }
  | { ok: false; reason: 'smsFailed' }

export type OtpCheckResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'locked' }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }

const MESSAGES: Record<OtpPurpose, (code: string) => string> = {
  signup: (c) => `${c} is your SidePerks code to create your account.`,
  verify_phone: (c) => `${c} is your SidePerks code to confirm this phone number.`,
  reset_password: (c) => `${c} is your SidePerks code to reset your password.`,
  change_password: (c) => `${c} is your SidePerks code to change your password.`,
  change_phone: (c) => `${c} is your SidePerks code to move your account to this number.`,
}

function hashCode(purpose: OtpPurpose, phone: string, code: string): string {
  return createHmac('sha256', requireSecretKey()).update(`${purpose}|${phone}|${code}`).digest('hex')
}

export async function issueOtp(input: {
  purpose: OtpPurpose
  phone: string
  userId?: string | null
}): Promise<OtpIssueResult> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const { ip } = await getRequestContext()
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('otp_issue', {
    p_purpose: input.purpose,
    p_phone: input.phone,
    p_user_id: input.userId ?? undefined,
    p_code_hash: hashCode(input.purpose, input.phone, code),
    p_ip: ip ?? undefined,
  })
  if (error) throw error

  const issued = data as {
    ok: boolean
    id?: string
    reason?: 'cooldown' | 'limit'
    retry_after?: string
    resend_seconds?: number
  }
  if (!issued.ok) {
    return { ok: false, reason: issued.reason ?? 'limit', retryAfter: issued.retry_after ?? '' }
  }

  const sent = await sendSms({
    to: input.phone,
    message: `${MESSAGES[input.purpose](code)} It expires soon. Never share it with anyone, including SidePerks staff.`,
    otp: true,
  })

  if (!sent.ok) {
    /* The row would otherwise hold the cooldown and count against the hourly
       cap for a message that never left, so a person who got nothing could
       not even ask again. */
    const { error: cleanup } = await admin.from('phone_otps').delete().eq('id', issued.id!)
    if (cleanup) reportUnexpected(cleanup, 'otp.cleanup-after-sms-failure')
    return { ok: false, reason: 'smsFailed' }
  }

  return { ok: true, resendSeconds: issued.resend_seconds ?? 60 }
}

export async function checkOtp(input: {
  purpose: OtpPurpose
  phone: string
  userId?: string | null
  code: string
}): Promise<OtpCheckResult> {
  const code = input.code.replace(/\D/g, '')
  if (code.length !== 6) return { ok: false, reason: 'wrong', attemptsLeft: 5 }

  const { data, error } = await createAdminClient().rpc('otp_check', {
    p_purpose: input.purpose,
    p_phone: input.phone,
    p_user_id: input.userId ?? undefined,
    p_code_hash: hashCode(input.purpose, input.phone, code),
  })
  if (error) throw error

  const checked = data as { ok: boolean; reason?: 'expired' | 'locked' | 'wrong'; attempts_left?: number }
  if (checked.ok) return { ok: true }
  if (checked.reason === 'wrong') return { ok: false, reason: 'wrong', attemptsLeft: checked.attempts_left ?? 0 }
  return { ok: false, reason: checked.reason === 'locked' ? 'locked' : 'expired' }
}

/** Best-effort notice to a number that has just stopped being the sign-in. */
export async function notifyPhone(phone: string, message: string): Promise<void> {
  const sent = await sendSms({ to: phone, message })
  if (!sent.ok) reportUnexpected(new Error(`notice not sent: ${sent.reason}`), 'otp.notice')
}
