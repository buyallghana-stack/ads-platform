'use client'

import { useTranslations } from 'next-intl'

/**
 * Resolves a Zod schema message into localised copy.
 *
 * The schemas carry translation KEYS rather than sentences, so nothing
 * user-facing is hardcoded in validation (§3). This turns `emailInvalid` into
 * the right sentence for the active locale.
 *
 * Anything unrecognised degrades to the generic message. Showing a user the
 * raw key — "passwordTooWeak" — is worse than a vague apology, and a missing
 * translation should not be able to produce that.
 */
export function useAuthErrorMessage() {
  const t = useTranslations('auth.errors')

  return (key?: string): string | undefined => {
    if (!key) return undefined
    try {
      const value = t(key as never)
      return value === key ? t('generic') : value
    } catch {
      return t('generic')
    }
  }
}
