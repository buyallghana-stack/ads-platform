import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * Every nav entry has a label, in both languages.
 *
 * Operator, 2026-08-12, with a screenshot of the admin menu reading
 * `admin.nav.items.adResponses` where a name should be. I had added the label
 * one level too high — `admin.nav.adResponses` instead of
 * `admin.nav.items.adResponses` — and next-intl renders the KEY PATH when it
 * cannot find a string. Nothing failed: not the typecheck, because the key is
 * a template string; not the build; not the suite. It went straight to the
 * operator's phone.
 *
 * ── WHY THIS TEST IS SHAPED LIKE THIS ──
 *
 * The nav is a list of `{ key, href }` objects and the component renders
 * `t(`items.${item.key}`)`. So the keys are knowable by reading the source,
 * and that is what this does: pull every `key:` out of the nav definition and
 * insist each one has a string in en AND fr.
 *
 * Reading the component as text rather than importing it is deliberate — the
 * file is a client component full of icons and hooks, and a test that has to
 * render React to check a translation would break for reasons that have
 * nothing to do with translations.
 */

const read = (path: string) => readFileSync(path, 'utf8')
const messages = (locale: string) =>
  JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>

const navKeys = () => {
  const source = read('src/components/admin/AdminNav.tsx')
  /* Only the entries in the nav definition: `{ key: 'ads', href: '/admin/ads'`.
     Anchoring on `href` is what keeps this from matching every other object
     with a `key` in the file. */
  return [...source.matchAll(/\{\s*key:\s*'([\w-]+)',\s*href:/g)].map((m) => m[1]!)
}

const groupKeys = () => {
  const source = read('src/components/admin/AdminNav.tsx')
  return [...source.matchAll(/\{\s*key:\s*'([\w-]+)',\s*items:/g)].map((m) => m[1]!)
}

const at = (tree: Record<string, unknown>, path: string[]) =>
  path.reduce<unknown>((node, step) => (node as Record<string, unknown>)?.[step], tree)

describe('the admin menu', () => {
  it('names every entry, in both languages', () => {
    const keys = navKeys()
    // A regex that silently matched nothing would pass this file entirely.
    expect(keys.length).toBeGreaterThan(10)

    for (const locale of ['en', 'fr']) {
      const tree = messages(locale)
      for (const key of keys) {
        const label = at(tree, ['admin', 'nav', 'items', key])
        expect(
          typeof label === 'string' && label.trim().length > 0,
          `${locale}: admin.nav.items.${key} is missing, so the menu would show the key`,
        ).toBe(true)
      }
    }
  })

  it('names every group, in both languages', () => {
    for (const locale of ['en', 'fr']) {
      const tree = messages(locale)
      for (const key of groupKeys()) {
        const label = at(tree, ['admin', 'nav', 'groups', key])
        expect(
          typeof label === 'string' && label.trim().length > 0,
          `${locale}: admin.nav.groups.${key} is missing`,
        ).toBe(true)
      }
    }
  })

  it('has no label sitting one level too high, which is how this broke', () => {
    for (const locale of ['en', 'fr']) {
      const nav = at(messages(locale), ['admin', 'nav']) as Record<string, unknown>
      const items = (nav.items ?? {}) as Record<string, unknown>
      /* A string directly under `admin.nav` that ALSO exists under
         `admin.nav.items` is the exact mistake: the label was written at the
         wrong depth and the right one never got filled in. */
      for (const [key, value] of Object.entries(nav)) {
        if (typeof value !== 'string') continue
        expect(
          key in items === false || items[key] !== undefined,
          `${locale}: admin.nav.${key} looks like a stray copy of an items label`,
        ).toBe(true)
      }
    }
  })
})
