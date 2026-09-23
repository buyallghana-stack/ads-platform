import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every form that carries a secret must say `method="post"`.
 *
 * ⚠️ FOUND ON THE LIVE SITE, NOT IN REVIEW. A sign-in during a walkthrough run
 * submitted before the page had hydrated, and because the form declared no
 * method, the browser did what HTML says to do: a GET to the current URL with
 * every field attached. The address bar read
 *
 *     /login?email=...&password=...&rememberMe=on
 *
 * and that string then lives in browser history, in the Referer header of the
 * next request, and in the server access log. The React handler was perfectly
 * correct; it simply was not running yet.
 *
 * `method="post"` is never used while the page works, because `onSubmit` calls
 * `preventDefault`. It is the behaviour when the page does NOT work that this
 * is for, and that is exactly when a credential must not end up in a URL.
 *
 * This test walks the files rather than naming them, so a form added tomorrow
 * is covered without anybody remembering to come back here.
 */

const ROOTS = ['src/components/auth', 'src/components/profile', 'src/components/withdraw']

/** Anything that would be shameful in an access log. */
const SECRET = /password|pin\b|code|token|secret|phrase|email/i

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('forms that carry secrets', () => {
  const files = ROOTS.flatMap(walk)

  it('finds the components to check', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('never leaves a credential form defaulting to GET', () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!SECRET.test(source)) continue

      /* Each `<form` opening tag, up to the end of that tag. */
      for (const match of source.matchAll(/<form\b[^>]*>/g)) {
        if (!/method\s*=\s*["']post["']/i.test(match[0])) {
          offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ').slice(0, 70)}`)
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
