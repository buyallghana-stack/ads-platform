import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, withRollback } from '../support/db'

/**
 * The no-dash rule reaches the DATABASE too.
 *
 * `no-dashes.test.ts` guards `messages/` and `src/content/legal/`, and it was
 * written believing those were the two places a user reads. They are not. The
 * affiliate course is thirty lessons, quizzes and answer options stored as
 * ROWS, written by the same hand and carrying the same habit: opening the
 * player after the light theme landed showed "There is no waiting period — it
 * lands in your commission balance straight away" on the first screen an
 * affiliate reads. Twenty-five sentences across eleven lesson bodies, one
 * lesson title and eighteen answer options.
 *
 * ⚠️ THIS ONE FAILS ON DATA, NOT ON CODE, so it cannot be fixed by editing a
 * file in the repo. Fix it with an UPDATE, and rewrite the sentence rather than
 * swapping the character: a blanket comma leaves splices ("no waiting period,
 * it lands straight away") and a blanket full stop leaves fragments ("With a
 * checkpoint at 4s."). What the punctuation should be depends on what the two
 * halves are doing.
 *
 * ⚠️ IT READS COMMITTED ROWS, so it is checking the live catalogue rather than
 * a fixture. That is the point: a lesson added through the admin next month is
 * copy nobody reviewed, and this is what reviews it.
 */

const DASH = /[—–]/

/** Columns a learner actually reads. Slugs and storage paths are excluded. */
const COPY = [
  ['lessons', 'title'],
  ['lessons', 'body'],
  ['course_sections', 'title'],
  ['quizzes', 'title'],
  ['quiz_questions', 'prompt'],
  ['quiz_options', 'body'],
  ['products', 'title'],
  ['products', 'description'],
] as const

describe.skipIf(!HAS_DB)('no dashes in course content', () => {
  for (const [table, column] of COPY) {
    it(`carries no em or en dash in ${table}.${column}`, async () => {
      await withRollback(async (tx: Tx) => {
        const { rows } = await tx.query<{ text: string }>(
          `select ${column} as text from public.${table} where ${column} is not null`,
        )

        const offenders = rows
          .map((row) => row.text)
          .filter((text) => DASH.test(text))
          /* The offending sentence, not the whole lesson body: a 400-word
             article printed in full buries the one line that has to change. */
          .flatMap((text) =>
            text
              .split(/(?<=[.!?])\s+/)
              .filter((sentence) => DASH.test(sentence))
              .map((sentence) => sentence.trim().slice(0, 120)),
          )

        expect(offenders, offenders.join('\n')).toHaveLength(0)
      })
    })
  }
})
