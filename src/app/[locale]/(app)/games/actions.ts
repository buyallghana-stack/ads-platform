'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import type { GameKind, PlayResult } from '@/lib/games/types'
import { GAME_KINDS } from '@/lib/games/types'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Playing a game.
 *
 * The client names a GAME and nothing else. It does not say which box it
 * tapped, it does not say what it won, and it could not be believed if it
 * did: `play_game` draws the outcome, consumes the play and writes the ledger
 * row in one transaction, and this action returns what the database decided.
 *
 * That is the whole security model for the feature. Any design where the
 * browser reports a result is a design where anybody with dev tools wins the
 * jackpot every time.
 */
export async function playGame(game: GameKind): Promise<PlayResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'not_signed_in' }

  // The argument comes off a URL segment, so it is checked rather than cast.
  if (!GAME_KINDS.includes(game)) return { ok: false, reason: 'error' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('play_game', {
    p_user_id: user.id,
    p_game: game,
  })

  if (error) {
    reportUnexpected(error, 'games.play', { game })
    return { ok: false, reason: 'error' }
  }

  const result = (data ?? {}) as {
    outcome?: string
    slot?: number
    label?: string
    points?: number
    extra_plays?: number
    remaining?: number
  }

  if (result.outcome === 'ok') {
    // The balance on Home and the history both moved.
    revalidatePath('/dashboard')
    return {
      ok: true,
      slot: Number(result.slot ?? 1),
      label: String(result.label ?? ''),
      value: Number(result.points ?? 0),
      extraPlays: Number(result.extra_plays ?? 0),
      remaining: Number(result.remaining ?? 0),
    }
  }

  const known = [
    'games_disabled',
    'no_plays_left',
    'too_soon',
    'account_disabled',
    'no_prizes_configured',
  ] as const
  const reason = known.find((r) => r === result.outcome)

  return { ok: false, reason: reason ?? 'error' }
}
