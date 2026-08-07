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
 * ⚠️ THE LEGAL DOCUMENTS ARE NOT IN `messages/`. They live in
 * `src/content/legal/*.ts`, which is why the first pass at this reported the
 * marketing page clean while Terms still carried 23 dashes and Privacy 45.
 * Both places are checked here now.
 *
 * ⚠️ SOURCE COMMENTS ARE DELIBERATELY OUT OF SCOPE, in both. They are written
 * for whoever maintains this, never rendered, and stripping them would be
 * thousands of lines of noise in a diff for no reader's benefit. So the legal
 * check looks inside string literals only.
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

  for (const doc of ['terms.en', 'terms.fr', 'privacy.en', 'privacy.fr']) {
    it(`carries no em or en dash in ${doc}`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'content', 'legal', `${doc}.ts`), 'utf8')

      /* Comments stripped first, then only what is left inside quotes counts.
         A dash in a note to the next maintainer is not a dash a user reads. */
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      const literals = withoutComments.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? []
      const offenders = literals.filter((text) => /[—–]/.test(text)).map((t) => t.slice(0, 90))

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
