import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, createAdmin, createUser, pinEconomy, withRollback } from '../support/db'

/**
 * Survey answers are written down, one row per question.
 *
 * Operator, 2026-08-12: *"the response of surveys are not recorded."* They
 * were not. The grading loop in `submit_ad_answers` read every visible
 * question, decided whether each was right, and then discarded all of it: one
 * `ad_attempts` row per submission, pinned to the FIRST question, with the
 * whole payload dumped in as text and a single verdict for the lot.
 *
 * So there was nothing to report on, and no test noticed, because every test
 * asked what the SUBMISSION returned rather than what was kept. These ask what
 * was kept.
 */

const surveyAd = async (tx: Tx) => {
  const { rows: ad } = await tx.query<{ id: string }>(
    `insert into public.ads (title, format, status, points_reward, weight, min_watch_seconds)
     values ('Survey fixture', 'survey', 'active', 100, 100, 0)
     returning id`,
  )
  const adId = ad[0]!.id

  /* One graded question and one opinion, which is the pair that matters: the
     graded one decides whether they are paid, and the opinion is the thing the
     advertiser actually bought. */
  const { rows: q1 } = await tx.query<{ id: string }>(
    `insert into public.ad_questions (ad_id, position, question_text, answer_format, correct_answer)
     values ($1, 1, 'Which city was in the advert?', 'multiple_choice', null)
     returning id`,
    [adId],
  )
  const { rows: options } = await tx.query<{ id: string; option_text: string }>(
    `insert into public.ad_question_options (question_id, option_text, is_correct, sort_order)
     values ($1, 'Kumasi', true, 1), ($1, 'Takoradi', false, 2)
     returning id, option_text`,
    [q1[0]!.id],
  )
  const { rows: q2 } = await tx.query<{ id: string }>(
    `insert into public.ad_questions (ad_id, position, question_text, answer_format, correct_answer)
     values ($1, 2, 'What would make you buy from them?', 'short_text', null)
     returning id`,
    [adId],
  )

  return {
    adId,
    graded: q1[0]!.id,
    opinion: q2[0]!.id,
    right: options.find((o) => o.option_text === 'Kumasi')!.id,
    wrong: options.find((o) => o.option_text === 'Takoradi')!.id,
  }
}

const answer = async (tx: Tx, userId: string, adId: string, payload: Record<string, string>) => {
  await tx.query(`select public.register_ad_view($1, $2)`, [userId, adId])
  await tx.query(
    `update public.user_ad_state set watch_started_at = now() - interval '45 seconds'
      where user_id = $1 and ad_id = $2`,
    [userId, adId],
  )
  const { rows } = await tx.query<{ outcome: string }>(
    `select * from public.submit_ad_answers($1, $2, $3::jsonb)`,
    [userId, adId, JSON.stringify(payload)],
  )
  return rows[0]!
}

const responses = async (tx: Tx, adId: string) => {
  const { rows } = await tx.query(
    `select question_position, question_text, answer_label, answer_text, is_correct,
            is_graded, occasion, attempt_number, watch_seconds, option_id
       from public.ad_responses where ad_id = $1
      order by attempt_number, question_position`,
    [adId],
  )
  return rows
}

describe.skipIf(!HAS_DB)('what people answered', () => {
  it('writes one row per question, with the option they chose', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const ad = await surveyAd(tx)
      const user = await createUser(tx, { name: 'Answers Things' })

      const result = await answer(tx, user.id, ad.adId, {
        [ad.graded]: ad.right,
        [ad.opinion]: 'Cheaper delivery, and a shop in Tamale',
      })
      expect(result.outcome).toBe('correct')

      const rows = await responses(tx, ad.adId)
      expect(rows).toHaveLength(2)

      // The graded one: the label is stored, not just the option id.
      expect(rows[0]).toMatchObject({
        question_position: 1,
        question_text: 'Which city was in the advert?',
        answer_label: 'Kumasi',
        is_graded: true,
        is_correct: true,
      })
      expect(rows[0]!.option_id).toBe(ad.right)

      /* ⚠️ THE OPINION IS THE POINT. An ungraded question has no right answer,
         so `is_correct` is NULL rather than false — false would read as a
         wrong answer to a question that cannot have one. */
      expect(rows[1]).toMatchObject({
        question_position: 2,
        answer_text: 'Cheaper delivery, and a shop in Tamale',
        is_graded: false,
        is_correct: null,
      })
    })
  })

  it('keeps a wrong answer, because a wrong answer is still data', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const ad = await surveyAd(tx)
      const user = await createUser(tx, { name: 'Gets It Wrong' })

      const first = await answer(tx, user.id, ad.adId, {
        [ad.graded]: ad.wrong,
        [ad.opinion]: 'Nothing',
      })
      expect(first.outcome).toBe('incorrect')

      const rows = await responses(tx, ad.adId)
      expect(rows).toHaveLength(2)
      expect(rows[0]!.answer_label).toBe('Takoradi')
      expect(rows[0]!.is_correct).toBe(false)
    })
  })

  it('separates the retry from the first try', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const ad = await surveyAd(tx)
      const user = await createUser(tx, { name: 'Tries Twice' })

      await answer(tx, user.id, ad.adId, { [ad.graded]: ad.wrong, [ad.opinion]: 'First go' })
      await answer(tx, user.id, ad.adId, { [ad.graded]: ad.right, [ad.opinion]: 'Second go' })

      const rows = await responses(tx, ad.adId)
      expect(rows).toHaveLength(4)
      expect(rows.map((r) => r.attempt_number)).toEqual([1, 1, 2, 2])
      /* Same occasion: they were watching the ad ONCE, and got it wrong first.
         A repeat tomorrow is a different occasion, which is what stops a
         report double counting one viewing. */
      expect(new Set(rows.map((r) => r.occasion))).toEqual(new Set([1]))
    })
  })

  it('keeps the wording as it read at the time, not as it reads now', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const ad = await surveyAd(tx)
      const user = await createUser(tx, { name: 'Answered Before The Edit' })

      await answer(tx, user.id, ad.adId, { [ad.graded]: ad.right, [ad.opinion]: 'Fine' })

      /* The operator rewrites the question afterwards, which they are entitled
         to do. The answer must still say what was actually asked. */
      await tx.query(`update public.ad_questions set question_text = 'Rewritten later' where id = $1`, [
        ad.graded,
      ])

      const rows = await responses(tx, ad.adId)
      expect(rows[0]!.question_text).toBe('Which city was in the advert?')
    })
  })

  it('reports them with the respondent, the plan and what the watch paid', async () => {
    await withRollback(async (tx) => {
      await pinEconomy(tx)
      const ad = await surveyAd(tx)
      const admin = await createAdmin(tx)
      const user = await createUser(tx, { name: 'Ama Boateng' })
      await tx.query(`update public.profiles set phone = '0240000111' where id = $1`, [user.id])

      await answer(tx, user.id, ad.adId, { [ad.graded]: ad.right, [ad.opinion]: 'Faster delivery' })

      const { rows } = await tx.query(
        `select * from public.admin_ad_responses($1, $2)`,
        [admin.id, ad.adId],
      )
      expect(rows).toHaveLength(2)

      const opinion = rows.find((r) => r.question_position === 2)!
      expect(opinion.respondent).toBe('Ama Boateng')
      expect(opinion.phone).toBe('0240000111')
      expect(opinion.answer).toBe('Faster delivery')
      /* Blank rather than a verdict: the CSV must not imply an opinion was
         marked. */
      expect(opinion.correct).toBeNull()
      // What that completion actually paid, joined from the ledger.
      expect(Number(opinion.points_awarded)).toBeGreaterThan(0)
    })
  })

  it('refuses to report to somebody who is not a super admin', async () => {
    await withRollback(async (tx) => {
      const ad = await surveyAd(tx)
      const user = await createUser(tx, { name: 'Not An Admin' })

      /* The rows carry a name and a phone number against every answer, so this
         is the same gate the money screens use. */
      await expect(
        tx.query(`select * from public.admin_ad_responses($1, $2)`, [user.id, ad.adId]),
      ).rejects.toThrow()
    })
  })
})
