import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { WithdrawalPinFlow } from '@/components/profile/WithdrawalPinFlow'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Withdrawal PIN',
  robots: { index: false, follow: false },
}

/**
 * Withdrawal PIN setup. Whether a PIN already exists is read through the
 * server-only has_withdrawal_pin function (the hash is never exposed); the flow
 * then offers set, change or reset accordingly.
 */
export default async function PinPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const admin = createAdminClient()
  const { data: hasPin } = await admin.rpc('has_withdrawal_pin', { p_user_id: user!.id })

  return <WithdrawalPinFlow hasPin={hasPin ?? false} />
}
