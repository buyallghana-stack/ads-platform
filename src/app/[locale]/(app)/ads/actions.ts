'use server'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The two server calls the player makes: start watching, then submit.
 *
 * Both go through the service client because `register_ad_view`,
 * `get_ad_questions_for_user` and `submit_ad_answers` are all revoked from
 * `authenticated` — the money path is not reachable from a browser token at
 * all. The user id comes from the verified session, never from the payload,
 * so "watch as somebody else" is not expressible.
 *
 * Questions are fetched only AFTER the view is registered. That ordering is
 * the point: a script cannot harvest an ad's questions without also starting
 * its server-side watch clock, and the clock is what makes answering early
 * impossible.
 */

export type AdQuestion = {
  id: string
  /** The admin's ordering. Also the survey step number. */
  index: number
  /** Second of the video at which this interrupts. Null = ask at the end. */
  showAtSeconds: number | null
  text: string
  format: 'multiple_choice' | 'short_text'
  /** Shuffled server-side on every call. Empty for short-text questions. */
  options: { id: string; text: string }[]
}

export type StartAdResult =
  | { ok: true; questions: AdQuestion[]; startedAt: string }
  /** The ad went away between the feed rendering and the tap — paused,
   *  exhausted, out of schedule, or already finished by this user. */
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'error' }

export async function startAd(adId: string): Promise<StartAdResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, reason: 'error' }

  const admin = createAdminClient()

  const { data: startedAt, error } = await admin.rpc('register_ad_view', {
    p_user_id: user.id,
    p_ad_id: adId,
  })
  // register_ad_view raises check_violation for every "you cannot watch this"
  // case and says which; the user only needs to know it is gone.
  if (error) return { ok: false, reason: 'unavailable' }

  const { data: rows, error: qError } = await admin.rpc('get_ad_questions_for_user', {
    p_ad_id: adId,
  })
  if (qError) return { ok: false, reason: 'error' }

  // One row per option (or one row with a null option for short text), so
  // fold them back into questions while preserving the shuffled option order.
  const byId = new Map<string, AdQuestion>()
  for (const row of rows ?? []) {
    let q = byId.get(row.question_id)
    if (!q) {
      q = {
        id: row.question_id,
        index: row.question_index,
        showAtSeconds: row.show_at_seconds,
        text: row.question_text,
        format: row.answer_format,
        options: [],
      }
      byId.set(row.question_id, q)
    }
    if (row.option_id) q.options.push({ id: row.option_id, text: row.option_text })
  }

  const questions = [...byId.values()].sort((a, b) => a.index - b.index)

  return { ok: true, questions, startedAt: startedAt as string }
}

/** Mirrors public.ad_answer_outcome. */
export type AdOutcome =
  | 'correct'
  | 'incorrect'
  | 'locked'
  | 'already_completed'
  | 'not_eligible'
  | 'not_watched'
  | 'too_fast'
  | 'daily_cap_reached'
  // Distinct from the ad cap since migration 040. A cooldown means "wait a
  // moment", a points cap means "you have earned the maximum today" — telling
  // either of them "come back tomorrow" was simply untrue.
  | 'cooldown_active'
  | 'points_cap_reached'
  | 'earning_blocked'

export type SubmitAdResult = {
  outcome: AdOutcome | 'error'
  pointsAwarded: number
  attemptsRemaining: number
  newBalance: number | null
  /** The database's own sentence. Shown only for outcomes the UI has no
   *  translated copy for — see the ads.result namespace. */
  message: string | null
}

/**
 * Submit every answer at once.
 *
 * Partial credit is deliberately not offered anywhere in this system: grading
 * one question at a time would let someone brute-force a survey question by
 * question. So the player collects answers as it goes — including the ones it
 * popped mid-video — and sends the whole map here.
 *
 * A watch-only ad submits an empty map, which is valid: with no questions to
 * grade, elapsed watch time is the whole test.
 */
export async function submitAd(
  adId: string,
  answers: Record<string, string>,
): Promise<SubmitAdResult> {
  const user = await getSessionUser()
  if (!user) {
    return {
      outcome: 'error',
      pointsAwarded: 0,
      attemptsRemaining: 0,
      newBalance: null,
      message: null,
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('submit_ad_answers', {
    p_user_id: user.id,
    p_ad_id: adId,
    p_answers: answers,
  })

  if (error || !data) {
    return {
      outcome: 'error',
      pointsAwarded: 0,
      attemptsRemaining: 0,
      newBalance: null,
      message: null,
    }
  }

  return {
    outcome: (data.outcome ?? 'error') as AdOutcome,
    pointsAwarded: Number(data.points_awarded ?? 0),
    attemptsRemaining: data.attempts_remaining ?? 0,
    newBalance: data.new_balance === null ? null : Number(data.new_balance),
    message: data.message ?? null,
  }
}
