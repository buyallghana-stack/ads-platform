import 'server-only'

import { normalisePhone } from '@/lib/auth/phone'
import { reportUnexpected } from '@/lib/observability/report'
import { sendSms } from '@/lib/sms/mnotify'
import { createAdminClient } from '@/lib/supabase/admin'
import { phone as phoneSchema } from '@/lib/validation/auth'

/**
 * Texts the operator that a buyer says they sent a manual plan payment, so
 * they know to check their phone and confirm it in the admin. Numbers from
 * `app_config.payment_alert_phones`. Best-effort: never affects the buyer.
 */
export async function alertManualPaymentClaimed(paymentId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const [{ data: config }, { data: p }] = await Promise.all([
      admin.from('app_config').select('value').eq('key', 'payment_alert_phones').maybeSingle(),
      admin
        .from('subscription_payments')
        .select('amount_minor, currency_code, manual_reference, manual_sender_name, manual_sender_phone, tiers(name)')
        .eq('id', paymentId)
        .maybeSingle(),
    ])
    const recipients = (config?.value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => phoneSchema.safeParse(v).success)
      .map(normalisePhone)
    if (!recipients.length || !p) return

    const row = p as unknown as {
      amount_minor: number
      currency_code: string
      manual_reference: string
      manual_sender_name: string
      manual_sender_phone: string
      tiers: { name: string } | null
    }
    const amount = `${row.currency_code} ${(row.amount_minor / 100).toLocaleString('en-GH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

    const message = [
      'Manual payment sent on SidePerks. Check your phone, then confirm it in Admin > Payments.',
      '',
      `Plan: ${row.tiers?.name ?? 'Plan'}`,
      `Amount: ${amount}`,
      `From: ${row.manual_sender_name} (${row.manual_sender_phone})`,
      `Reference: ${row.manual_reference}`,
    ].join('\n')

    for (const to of recipients) {
      const sent = await sendSms({ to, message })
      if (!sent.ok) reportUnexpected(new Error(`manual payment alert SMS ${sent.reason}`), 'upgrade.manual-alert-sms')
    }
  } catch (error) {
    reportUnexpected(error, 'upgrade.manual-alert-sms')
  }
}
