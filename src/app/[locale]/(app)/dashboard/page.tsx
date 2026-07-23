import type { Metadata } from 'next'

import { Coins, Gift, PlayCircle, Wallet } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LogOutButton } from '@/components/app/LogOutButton'
import { Logo } from '@/components/brand/Logo'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardFooter, CardHeader, StatCard as Stat } from '@/components/ui/Card'
import { redirect } from '@/i18n/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
}

/**
 * User dashboard — first pass.
 *
 * Deliberately minimal. §0.2 says not to invent visual design, and no
 * references have arrived for this surface yet, so this shows real data using
 * only primitives the operator has already approved on the styleguide. It
 * exists mainly so the auth flow has somewhere to land and so the whole stack
 * can be seen working end to end.
 *
 * The live balance, cap ring, ad feed and history come with the real design.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not signed in — this becomes a middleware matcher once there are several
  // protected routes; a single check is clearer than a config for one page.
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('dashboard')

  /*
    get_user_earning_status is SECURITY DEFINER with its own authorisation
    check, so it may be called for the signed-in user directly. It returns
    balance, tier, cap progress and cedi value in one round trip rather than
    four queries (§8).
  */
  const admin = createAdminClient()
  const [{ data: status }, { data: profile }] = await Promise.all([
    admin.rpc('get_user_earning_status', { p_user_id: user!.id }).maybeSingle(),
    admin.from('profiles').select('full_name, referral_code').eq('id', user!.id).maybeSingle(),
  ])

  const balance = status?.balance ?? 0
  const currency = status?.currency_value ?? 0
  const cap = status?.daily_ad_cap ?? 0
  const done = status?.ads_completed_today ?? 0
  const remaining = status?.ads_remaining_today ?? 0

  return (
    <div className="min-h-dvh bg-ink-100">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Logo variant="dark" />
          <div className="flex items-center gap-3">
            <span className="hidden text-[0.8125rem] text-ink-500 sm:inline">
              {profile?.full_name ?? user!.email}
            </span>
            <LogOutButton label={t('logOut')} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-6 sm:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">
            {t('greeting', { name: (profile?.full_name ?? '').split(' ')[0] || t('there') })}
          </h1>
          <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
        </div>

        {status?.account_disabled && (
          <div
            role="alert"
            className="rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-4 py-3 text-[0.8125rem] text-danger-700"
          >
            {t('accountDisabled')}
          </div>
        )}

        {status?.earning_paused && !status?.account_disabled && (
          <div
            role="status"
            className="rounded-(--radius-card) border border-warning-500/25 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-600"
          >
            {t('earningPaused')}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t('balance')}
            value={balance.toLocaleString()}
            sublabel={`GHS ${Number(currency).toFixed(2)}`}
            icon={<Coins />}
          />
          <Stat
            label={t('adsToday')}
            value={`${done} / ${cap}`}
            sublabel={t('remaining', { count: remaining })}
            icon={<PlayCircle />}
          />
          <Stat label={t('tier')} value={status?.tier_name ?? '—'} icon={<Wallet />} />
          <Stat
            label={t('referralCode')}
            value={<span className="tracking-[0.12em]">{profile?.referral_code ?? '—'}</span>}
            sublabel={t('referralHint')}
            icon={<Gift />}
          />
        </div>

        <Card>
          <CardHeader
            title={t('watchTitle')}
            description={t('watchDescription')}
            action={<Badge tone="neutral">{t('comingSoon')}</Badge>}
          />
          <CardBody>
            <p className="text-[0.8125rem] leading-relaxed text-ink-500">{t('watchBody')}</p>
          </CardBody>
          <CardFooter>
            <span className="text-[0.75rem] text-ink-500">{t('watchFooter')}</span>
          </CardFooter>
        </Card>
      </main>
    </div>
  )
}
