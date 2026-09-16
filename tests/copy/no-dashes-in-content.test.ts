import { describe, expect, it } from 'vitest'

import { HAS_DB, type Tx, withRollback } from '../support/db'

/**
 * The no-dash rule reaches the DATABASE too.
 *
 * `no-dashes.test.ts` guards `messages/` and `src/content/legal/`, and it was
 * written believing those were the two places a user reads. They are not. Copy
 * typed into the admin is copy nobody reviewed, and it reaches a screen just
 * the same.
 *
 * ⚠️ RETARGETED 2026-09-16. This file used to read the affiliate course:
 * lessons, sections, quizzes and product descriptions. Migration
 * 20260865000000 dropped every one of those tables, so the test was failing on
 * relations that no longer exist rather than on anything anybody had written.
 * The rule did not go away with the course, so it now watches the copy that IS
 * still authored by hand: ads, announcements and the plan ladder.
 *
 * ⚠️ IT FAILS ON DATA, NOT ON CODE, so it cannot be fixed by editing a file in
 * the repo. Fix it with an UPDATE, and rewrite the sentence rather than
 * swapping the character: a blanket comma leaves splices ("no waiting period,
 * it lands straight away") and a blanket full stop leaves fragments ("With a
 * checkpoint at 4s."). What the punctuation should be depends on what the two
 * halves are doing.
 *
 * ⚠️ IT READS COMMITTED ROWS, so it is checking what is live rather than a
 * fixture. That is the point: an ad written through the admin next month is
 * copy nobody reviewed, and this is what reviews it.
 */

const DASH = /[—–]/

/** Columns a user actually reads. Slugs and storage paths are excluded. */
const COPY = [
  ['ads', 'title'],
  ['ads', 'description'],
  ['ads', 'cta_label'],
  ['ads', 'article_body'],
  ['announcements', 'title'],
  ['announcements', 'body'],
  ['tiers', 'name'],
  ['tiers', 'description'],
] as const

describe.skipIf(!HAS_DB)('no dashes in admin-authored copy', () => {
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
