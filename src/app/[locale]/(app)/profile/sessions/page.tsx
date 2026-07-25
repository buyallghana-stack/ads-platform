import type { Metadata } from 'next'

import { setRequestLocale } from 'next-intl/server'

import { SessionsList, type SessionRow } from '@/components/profile/SessionsList'
import { redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { describeUserAgent } from '@/lib/security/user-agent'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Active sessions',
  robots: { index: false, follow: false },
}

/**
 * Where the account is signed in. Read through the RLS user client: the
 * function is scoped by auth.uid() and identifies the current session from the
 * access token's own session_id claim, so nothing here is caller-supplied.
 */
export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const supabase = await createClient()
  const { data } = await supabase.rpc('get_active_sessions')

  const sessions: SessionRow[] = (data ?? []).map((row) => {
    const { device, browser } = describeUserAgent(row.user_agent)
    return {
      id: row.id,
      createdAt: row.created_at,
      lastSeen: row.last_seen,
      device,
      browser,
      ip: row.ip,
      isCurrent: Boolean(row.is_current),
    }
  })

  return <SessionsList sessions={sessions} now={Date.now()} />
}
