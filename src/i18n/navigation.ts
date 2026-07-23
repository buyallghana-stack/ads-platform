import { createNavigation } from 'next-intl/navigation'

import { routing } from './routing'

/**
 * Locale-aware replacements for next/link and next/navigation. Importing these
 * instead of the Next.js originals means every link keeps the user in their
 * current locale without any call site having to think about it.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
