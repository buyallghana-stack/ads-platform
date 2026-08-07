import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { MysteryBox } from '@/components/games/MysteryBox'
import { SpinWheel } from '@/components/games/SpinWheel'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { GAME_SLUGS } from '@/lib/games/types'
import { getAffiliateGameBoard, getAffiliateGameStatus } from '@/lib/market/play'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; game: string }>
}): Promise<Metadata> {
  const { locale, game } = await params
  const t = await getTranslations({ locale, namespace: 'games' })
  const kind = GAME_SLUGS[game]
  return {
    title: kind === 'spin_wheel' ? t('wheel.name') : t('box.name'),
    robots: { index: false, follow: false },
  }
}

/**
 * One affiliate game: the real wheel, the real boxes.
 *
 * Identical to `(app)/games/[game]/page.tsx` apart from three things: the
 * board and the allowance come from the affiliate engine, the skin records the
 * play against `commission_ledger`, and the back link goes to the affiliate
 * hub. Same components, same animation, same reveal.
 */
export default async function AffiliateGamePage({
  params,
}: {
  params: Promise<{ locale: string; game: string }>
}) {
  const { locale, game } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const kind = GAME_SLUGS[game]
  if (!kind) notFound()

  const status = await getAffiliateGameStatus(user!.id)
  if (!status.enabled) notFound()

  const [board, t] = await Promise.all([
    getAffiliateGameBoard(kind),
    getTranslations('games'),
  ])
  if (board.length === 0) notFound()

  const shared = {
    enabled: status.enabled,
    allowance: status.allowance,
    used: status.used,
    remaining: status.left,
    weekEndsAt: new Date(
      new Date(`${status.weekStart}T00:00:00Z`).getTime() + 7 * 86_400_000,
    ).toISOString(),
  }

  return (
    <div className="mx-auto w-full max-w-lg px-1 pt-2 pb-10">
      <Link
        href="/market/games"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 hover:text-ink-700"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('title')}
      </Link>

      <h1 className="text-center text-[1.375rem] font-bold tracking-[-0.02em] text-ink-900">
        {kind === 'spin_wheel' ? t('wheel.name') : t('box.name')}
      </h1>

      <div className="mt-5">
        {kind === 'spin_wheel' ? (
          <SpinWheel faces={board} status={shared} skin="affiliate" />
        ) : (
          <MysteryBox faces={board} status={shared} skin="affiliate" />
        )}
      </div>
    </div>
  )
}
