import { privacyEn } from './privacy.en'
import { privacyFr } from './privacy.fr'
import { termsEn } from './terms.en'
import { termsFr } from './terms.fr'
import type { LegalDoc } from './types'

export type LegalKind = 'terms' | 'privacy'

const DOCS: Record<LegalKind, Record<string, LegalDoc>> = {
  terms: { en: termsEn, fr: termsFr },
  privacy: { en: privacyEn, fr: privacyFr },
}

/** English is the fallback: a missing translation must not blank a legal page. */
export function getLegalDoc(kind: LegalKind, locale: string): LegalDoc {
  return DOCS[kind][locale] ?? DOCS[kind].en
}

export * from './types'
