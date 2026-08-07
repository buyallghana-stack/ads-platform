'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getViewAsSession } from '@/lib/admin/view-as'
import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PlayResult } from '@/lib/games/types'

/**
 * One play of an affiliate game.
 *
 * ── THE CLIENT SENDS WHICH GAME AND NOTHING ELSE ──
 *
 * Not the prize, not the slot, not the roll. `play_affiliate_game` draws the
 * result from `gen_random_bytes` against the live weights and writes both the
 * play and the money in one statement. A browser that could name its own prize
 * is not a game, and a server action is a public HTTP endpoint, so anything
 * the client sends about the outcome is a claim.
 *
 * The allowance, the licence switch and "are you even an affiliate" are all
 * checked in there too, so a second tab cannot spend a play that is gone.
 */

const schema = z.object({ game: z.enum(['mystery_box', 'spin_wheel']) })

export type PlayOutcome =
  | {
      ok: true
      label: string
      amountMinor: number
      extraPlays: number
      slot: number
      left: number
    }
  | { ok: false; message: string }

const GENERIC = 'That play did not go through. Nothing was used up.'

export async function playAffiliateGame(input: {
  game: 'mystery_box' | 'spin_wheel'
}): Promise<PlayOutcome> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: GENERIC }
  if (await getViewAsSession()) return { ok: false, message: GENERIC }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('play_affiliate_game', {
    p_user_id: user.id,
    p_game: parsed.data.game,
  })

  if (error) {
    const message = humanise(error.message)
    if (message === GENERIC) reportUnexpected(error, 'affiliate.games.play')
    return { ok: false, message }
  }

  const row = (data ?? {}) as Record<string, unknown>
  const status = (row.status ?? {}) as Record<string, unknown>

  /* A prize is money: the balance on the dashboard and the statement both
     change the moment this returns. */
  revalidatePath('/market')
  revalidatePath('/commission')

  return {
    ok: true,
    label: String(row.label ?? ''),
    amountMinor: Number(row.amount_minor ?? 0),
    extraPlays: Number(row.extra_plays ?? 0),
    slot: Number(row.slot ?? 0),
    left: Number(status.left ?? 0),
  }
}

function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|duplicate key|syntax error/i.test(clean)) return GENERIC
  return clean
}

/**
 * The same play, in the shape the shared wheel and box expect.
 *
 * `PlayResult` is the ads engine's vocabulary and the components speak it. The
 * adapter is here rather than in the component so that exactly one file knows
 * that `value` carries pesewas on this side of the app.
 */
export async function playAffiliateGameForBoard(
  game: 'mystery_box' | 'spin_wheel',
): Promise<PlayResult> {
  const outcome = await playAffiliateGame({ game })

  if (!outcome.ok) {
    /* The components render `errors.<reason>` out of the games namespace, so
       the refusals map onto the ones that already have wording. */
    const reason: Extract<PlayResult, { ok: false }>['reason'] = /not open yet/i.test(
      outcome.message,
    )
      ? 'games_disabled'
      : /no plays left/i.test(outcome.message)
        ? 'no_plays_left'
        : /not an affiliate/i.test(outcome.message)
          ? 'account_disabled'
          : /no prizes/i.test(outcome.message)
            ? 'no_prizes_configured'
            : 'error'
    return { ok: false, reason }
  }

  return {
    ok: true,
    slot: outcome.slot,
    label: outcome.label,
    value: outcome.amountMinor,
    extraPlays: outcome.extraPlays,
    remaining: outcome.left,
  }
}
