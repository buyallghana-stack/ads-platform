import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No em dashes or en dashes in anything a user reads.
 *
 * The operator's instruction, 2026-08-07: "remove all the double dash you apply
 * in text, it looks very AI and unprofessional to me." 120 English strings and
 * 95 French ones carried one. They were rewritten with the punctuation the
 * sentence actually wanted: a colon where the second half explains the first, a
 * full stop where it is a sentence of its own, parentheses around an aside, and
 * "to" inside a range.
 *
 * This test exists because copy is added constantly and the habit is mine, not
 * the codebase's. A rule nobody can enforce is a rule that lasts one session.
 *
 * ⚠️ SCOPE IS DELIBERATELY THE MESSAGE FILES. Source comments are full of them
 * and stay that way: they are written for whoever maintains this, never
 * rendered, and stripping them would be thousands of lines of noise in a diff
 * for no reader's benefit.
 */

const LOCALES = ['en', 'fr'] as const

/** Every leaf string in the file, with the path that reaches it. */
function flatten(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, path ? `${path}.${key}` : key),
  )
}

describe('user-facing copy', () => {
  for (const locale of LOCALES) {
    it(`carries no em or en dash in ${locale}`, () => {
      const file = join(process.cwd(), 'messages', `${locale}.json`)
      const strings = flatten(JSON.parse(readFileSync(file, 'utf8')))

      const offenders = strings
        .filter(([, text]) => /[—–]/.test(text))
        .map(([path, text]) => `${path}: ${text.slice(0, 80)}`)

      expect(offenders, offenders.join('\n')).toHaveLength(0)
    })
  }

  /* The two files are translations of each other, so a key in one and not the
     other is a screen that renders a raw key path to somebody. Cheap to check
     here, and this is the only test that already loads both. */
  it('has the same keys in every locale', () => {
    const [en, fr] = LOCALES.map((locale) =>
      flatten(JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')))
        .map(([path]) => path)
        .sort(),
    )
    expect(fr).toEqual(en)
  })
})
