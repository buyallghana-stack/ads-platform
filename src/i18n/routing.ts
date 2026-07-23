import { defineRouting } from 'next-intl/routing'

/**
 * Locale routing.
 *
 * English carries no prefix (`/signup`) and French does (`/fr/signup`). The
 * platform serves Ghana only, where English is official, so making the
 * majority path prefix-free keeps URLs clean and avoids a redirect on every
 * first visit. French is a forward bet on francophone West Africa rather than
 * current demand.
 *
 * Adding a locale is: append it here, drop in `messages/<locale>.json`. No
 * other file needs to change.
 */
export const routing = defineRouting({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
})

export type Locale = (typeof routing.locales)[number]
