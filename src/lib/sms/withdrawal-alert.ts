import 'server-only'

import { normalisePhone } from '@/lib/auth/phone'
import { reportUnexpected } from '@/lib/observability/report'
import { sendSms } from '@/lib/sms/mnotify'
import { createAdminClient } from '@/lib/supabase/admin'
import { phone as phoneSchema } from '@/lib/validation/auth'

/**
 * Texts the operator that a withdrawal was requested (operator direction
 * 2026-09-28). The numbers live in `app_config.withdrawal_alert_phones`.
 *
 * The amount is the NET, after the withdrawal fee: what actually has to be
 * sent, and the figure the payout queue shows. A crypto payout names the coin
 * amount, which is quoted from the net.
 *
 * Best-effort: a text that fails never touches the member's request.
 */
export async function alertWithdrawalRequested(redemptionId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const [{ data: config }, { data: r }] = await Promise.all([
      admin.from('app_config').select('value').eq('key', 'withdrawal_alert_phones').maybeSingle(),
      admin
        .from('redemptions')
        .select(
          'method, currency_amount, net_amount, coin_amount, snapshot_coin_code, snapshot_network_code, snapshot_provider_code, snapshot_account_name',
        )
        .eq('id', redemptionId)
        .maybeSingle(),
    ])

    const recipients = (config?.value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => phoneSchema.safeParse(v).success)
      .map(normalisePhone)
    if (!recipients.length || !r) return

    const net = Number(r.net_amount ?? r.currency_amount)
    const cedis = `GHS ${net.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    let amount = cedis
    let network: string
    if (r.method === 'crypto') {
      if (r.coin_amount !== null && r.snapshot_coin_code) amount = `${Number(r.coin_amount)} ${r.snapshot_coin_code} (${cedis})`
      network = [r.snapshot_coin_code, r.snapshot_network_code].filter(Boolean).join(' on ') || 'Crypto'
    } else {
      const { data: provider } = r.snapshot_provider_code
        ? await admin.from('payout_providers').select('name').eq('code', r.snapshot_provider_code).maybeSingle()
        : { data: null }
      network = provider?.name ?? r.snapshot_provider_code ?? 'Mobile money'
    }

    const message = [
      'Withdrawal requested from SidePerks.',
      '',
      `Account Name: ${r.snapshot_account_name || 'Not given'}`,
      `Amount: ${amount}`,
      `Network: ${network}`,
    ].join('\n')

    for (const to of recipients) {
      const sent = await sendSms({ to, message })
      if (!sent.ok) reportUnexpected(new Error(`withdrawal alert SMS ${sent.reason}`), 'withdraw.alert-sms')
    }
  } catch (error) {
    reportUnexpected(error, 'withdraw.alert-sms')
  }
}
