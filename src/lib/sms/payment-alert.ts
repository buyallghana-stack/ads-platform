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
export async function alertManualPaymentClaimed(kind: 'plan' | 'vault', paymentId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const [{ data: config }, { data: p }] = await Promise.all([
      admin.from('app_config').select('value').eq('key', 'payment_alert_phones').maybeSingle(),
      kind === 'vault'
        ? admin
            .from('vault_payments')
            .select('amount_minor, balance_minor, currency_code, manual_reference, manual_sender_phone, vault_plans(name)')
            .eq('id', paymentId)
            .maybeSingle()
        : admin
            .from('subscription_payments')
            .select('amount_minor, balance_minor, currency_code, manual_reference, manual_sender_phone, tiers(name)')
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
      balance_minor: number | null
      currency_code: string
      manual_reference: string
      manual_sender_phone: string
      tiers?: { name: string } | null
      vault_plans?: { name: string } | null
    }
    const money = (minor: number) =>
      `${row.currency_code.trim()} ${(minor / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fromBalance = Number(row.balance_minor ?? 0)
    // A plan's amount_minor is already the cash part; a Vault's is the full deposit.
    const cash = kind === 'vault' ? row.amount_minor - fromBalance : row.amount_minor

    const message = [
      'Manual payment sent on SidePerks. Check your phone, then confirm it in Admin > Payments.',
      '',
      kind === 'vault' ? `Vault: ${row.vault_plans?.name ?? 'Vault'}` : `Plan: ${row.tiers?.name ?? 'Plan'}`,
      `Amount sent: ${money(cash)}`,
      ...(fromBalance > 0 ? [`From balance: ${money(fromBalance)}`] : []),
      `From: ${row.manual_sender_phone}`,
      `Reference: ${row.manual_reference}`,
    ].join('\n')

    for (const to of recipients) {
      const sent = await sendSms({ to, message })
      if (!sent.ok) reportUnexpected(new Error(`manual payment alert SMS ${sent.reason}`), 'manual.alert-sms')
    }
  } catch (error) {
    reportUnexpected(error, 'manual.alert-sms')
  }
}
