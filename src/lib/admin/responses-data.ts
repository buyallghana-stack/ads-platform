import 'server-only'

import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Survey answers, for the report screen.
 *
 * Through the SERVICE client, and `admin_ad_responses` is revoked from
 * `authenticated` outright: the rows carry a name and a phone number against
 * every answer, so no browser token may ask for them. The acting admin is
 * named from the verified session and the function calls `assert_admin`
 * itself, which is SUPER ADMIN — an ads manager can write a survey and cannot
 * export who answered it.
 */

export type AdResponseRow = {
  answeredAt: string
  adTitle: string
  adFormat: string
  adId: string
  questionPosition: number | null
  questionText: string
  answerFormat: string
  graded: boolean
  answer: string | null
  optionId: string | null
  correct: boolean | null
  occasion: number
  attemptNumber: number
  watchSeconds: number | null
  respondent: string
  phone: string | null
  userId: string
  plan: string
  pointsAwarded: number | null
}

export type ResponsesScreenData = {
  rows: AdResponseRow[]
  /** Every ad that has at least one answer, for the filter. */
  ads: { id: string; title: string; format: string; responses: number }[]
  adId: string | null
}

export async function getAdResponses(adId?: string | null): Promise<ResponsesScreenData> {
  const user = await getSessionUser()
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('admin_ad_responses', {
    p_admin_id: user!.id,
    p_ad_id: adId ?? undefined,
  })

  if (error || !data) return { rows: [], ads: [], adId: adId ?? null }

  const rows: AdResponseRow[] = (
    data as unknown as Record<string, unknown>[]
  ).map((r) => ({
    answeredAt: String(r.answered_at),
    adTitle: String(r.ad_title),
    adFormat: String(r.ad_format),
    adId: String(r.ad_id),
    questionPosition: r.question_position === null ? null : Number(r.question_position),
    questionText: String(r.question_text),
    answerFormat: String(r.answer_format),
    graded: Boolean(r.graded),
    answer: r.answer === null ? null : String(r.answer),
    optionId: r.option_id === null ? null : String(r.option_id),
    correct: r.correct === null ? null : Boolean(r.correct),
    occasion: Number(r.occasion),
    attemptNumber: Number(r.attempt_number),
    watchSeconds: r.watch_seconds === null ? null : Number(r.watch_seconds),
    respondent: String(r.respondent),
    phone: r.phone === null || r.phone === undefined ? null : String(r.phone),
    userId: String(r.user_id),
    plan: String(r.plan),
    pointsAwarded: r.points_awarded === null ? null : Number(r.points_awarded),
  }))

  /* The filter is built from the answers themselves rather than from the ad
     pool: an ad with no responses is not worth offering, and an ad that has
     been deleted still has answers worth reading. */
  const byAd = new Map<string, { id: string; title: string; format: string; responses: number }>()
  for (const row of rows) {
    const seen = byAd.get(row.adId)
    if (seen) seen.responses += 1
    else byAd.set(row.adId, { id: row.adId, title: row.adTitle, format: row.adFormat, responses: 1 })
  }

  return {
    rows,
    ads: [...byAd.values()].sort((a, b) => a.title.localeCompare(b.title)),
    adId: adId ?? null,
  }
}
