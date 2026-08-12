/**
 * The `@property` fallbacks must keep up with Tailwind.
 *
 * Tailwind v4 registers its internal variables with `@property`, which supplies
 * an initial value. Safari learned `@property` in 16.4 and an iPhone 7 stops at
 * 15.6, so on that phone every registered variable is EMPTY and any declaration
 * reading one is invalid and dropped. `.border` is
 * `border-style: var(--tw-border-style); border-width: 1px`, so losing it left
 * every card on the Ads tab with no outline (operator, 2026-08-12).
 *
 * `globals.css` restates those initial values as plain declarations. A Tailwind
 * upgrade that registers a NEW variable would reopen the hole silently, so this
 * compares the two lists and fails if the built CSS has one the stylesheet does
 * not.
 *
 *   npm run build && node scripts/check-legacy-css.mjs
 *
 * Only variables with an `initial-value` are required: the rest are meant to be
 * empty, and declaring them would change what modern browsers do.
 */
import { globSync, readFileSync } from 'node:fs'

const bundles = globSync('.next/static/chunks/*.css')
if (bundles.length === 0) {
  console.error('No built CSS found. Run `npm run build` first.')
  process.exit(1)
}

const css = bundles.map((f) => readFileSync(f, 'utf8')).join('\n')
const globals = readFileSync('src/app/globals.css', 'utf8')

const registered = new Map()
for (const m of css.matchAll(/@property\s+(--tw-[\w-]+)\s*\{([^}]*)\}/g)) {
  const initial = (m[2].match(/initial-value:\s*([^;]*)/) ?? [])[1]
  if (initial !== undefined) registered.set(m[1], initial.trim())
}

if (registered.size === 0) {
  console.error('No @property blocks in the bundle. Has Tailwind changed how it emits them?')
  process.exit(1)
}

const missing = [...registered.keys()].filter((name) => !globals.includes(`${name}:`))

/* The reverse drift matters less but is still worth saying: a fallback for a
   variable Tailwind no longer registers is dead weight, and dead weight in a
   base rule applies to every element on every page. */
const declared = [...globals.matchAll(/(--tw-[\w-]+):/g)].map((m) => m[1])
const stale = [...new Set(declared)].filter((name) => !registered.has(name))

console.log(`registered with an initial value: ${registered.size}`)
console.log(`declared in globals.css:          ${new Set(declared).size}`)

if (missing.length) {
  console.error(`\nMISSING FALLBACKS (${missing.length}) — old Safari drops any rule using these:`)
  for (const name of missing) console.error(`  ${name}: ${registered.get(name)};`)
}
if (stale.length) {
  console.error(`\nNO LONGER REGISTERED (${stale.length}), so the fallback can go:`)
  for (const name of stale) console.error(`  ${name}`)
}

if (missing.length || stale.length) process.exit(1)
console.log('\nevery registered initial value has a plain fallback')
