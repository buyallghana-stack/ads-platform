import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { MysteryBox } from '@/components/games/MysteryBox'
import { SpinWheel } from '@/components/games/SpinWheel'
import { Link, redirect } from '@/i18n/navigation'
import { getViewAsSession } from '@/lib/admin/view-as'
import { getViewerUser } from '@/lib/auth/session'
import { getGameBoard, getGameStatus } from '@/lib/games/data'
import { GAME_SLUGS } from '@/lib/games/types'

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
 * One game.
 *
 * The board and the play count are fetched here and handed down, so the game
 * component starts with everything it needs and the first tap goes straight
 * to the draw rather than waiting on a board request.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; game: string }>
}) {
  const { locale, game } = await params
  setRequestLocale(locale)

  const kind = GAME_SLUGS[game]
  if (!kind) notFound()

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  /* A board is the one screen in this group that only makes sense for the
     person holding the plays. Under "view as user" the middleware refuses
     every POST, so `playGame` would 403 on the first tap — and the play it
     was refusing would have spent the ADMIN's allowance, not the user's,
     because writes always run as the real signed-in account. Send the admin
     to the hub, where the number they came to check is the honest one. */
  if (await getViewAsSession()) redirect({ href: '/games', locale })

  const status = await getGameStatus(user!.id)
  if (!status.enabled) notFound()
  /* A plan that grants no plays cannot open a board by URL either. The game
     screen's only word for it is "You have used all your plays this week",
     which is the same false renewal promise the hub used to make. The hub is
     where the honest answer now lives, so send them there. */
  if (status.allowance === 0) redirect({ href: '/games', locale })

  const [board, t] = await Promise.all([getGameBoard(kind), getTranslations('games')])
  if (board.length === 0) notFound()

  return (
    <div className="mx-auto w-full max-w-lg px-1 pb-10 pt-2">
      <Link
        href="/games"
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
          <SpinWheel faces={board} status={status} />
        ) : (
          <MysteryBox faces={board} status={status} />
        )}
      </div>
    </div>
  )
}
