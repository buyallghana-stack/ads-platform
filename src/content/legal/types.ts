/**
 * Legal documents as structured content rather than a wall of markup, so both
 * locales render through one component and the table of contents can be built
 * from the same source the body is.
 */
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'note'; text: string }

export type LegalSection = {
  /** Stable anchor id — keep it fixed across edits so links keep working. */
  id: string
  heading: string
  blocks: LegalBlock[]
}

export type LegalDoc = {
  title: string
  /** ISO date this wording last changed. */
  updated: string
  summary: string
  sections: LegalSection[]
}

/**
 * Who the user is actually contracting with.
 *
 * The lawyer's opinion of 2026-07-30 (`legal/lawyer-opinion-2026-07-30.md`)
 * sets what must appear: because the operator trades as a SOLE PROPRIETORSHIP
 * there is no obligation to publish licensing details, but the registered
 * business name, the business address and contact information are required so
 * users know who they are contracting with. `registrationNumber` is therefore
 * optional — a sole proprietorship's registration number may be shown but is
 * not what the requirement turns on.
 *
 * Supplied by the operator on 2026-07-30. The address is recorded exactly as
 * they gave it; nothing has been added to it. If a city, digital address or
 * postal code belongs on it, it is theirs to add — a legal document is the
 * wrong place to guess at the rest of somebody's address.
 */
export const LEGAL_ENTITY = {
  product: 'SidePerks',
  /** Registered business name. Same as the product name, by the operator's choice. */
  legalName: 'SidePerks' as string | null,
  /** Optional for a sole proprietorship; not yet supplied. */
  registrationNumber: null as string | null,
  /** Business address users can write to. */
  address: 'East Legon, BLK54, Vantage Office' as string | null,
  contactEmail: 'buyallghana@gmail.com',
  country: 'Ghana',
}

/**
 * The identifying details a user is entitled to see, as display lines. Only
 * what is actually known is returned — a missing line is better than a
 * placeholder that looks like a real registration.
 */
export function businessDetails(locale: 'en' | 'fr' = 'en'): string[] {
  const t =
    locale === 'fr'
      ? {
          trading: 'Nom commercial',
          legal: 'Raison sociale enregistrée',
          reg: "Numéro d'enregistrement",
          addr: 'Adresse professionnelle',
          email: 'E-mail',
          country: 'Pays',
        }
      : {
          trading: 'Trading as',
          legal: 'Registered business name',
          reg: 'Business registration number',
          addr: 'Business address',
          email: 'Email',
          country: 'Country',
        }

  // When the registered name and the product name are the same word, saying it
  // twice reads as though one of them is wrong. One line, labelled as the
  // registered name, since that is the one the user needs.
  const lines: string[] = []
  if (LEGAL_ENTITY.legalName === LEGAL_ENTITY.product) {
    lines.push(`${t.legal}: ${LEGAL_ENTITY.product}`)
  } else {
    lines.push(`${t.trading}: ${LEGAL_ENTITY.product}`)
    if (LEGAL_ENTITY.legalName) lines.push(`${t.legal}: ${LEGAL_ENTITY.legalName}`)
  }
  if (LEGAL_ENTITY.registrationNumber)
    lines.push(`${t.reg}: ${LEGAL_ENTITY.registrationNumber}`)
  if (LEGAL_ENTITY.address) lines.push(`${t.addr}: ${LEGAL_ENTITY.address}`)
  lines.push(`${t.email}: ${LEGAL_ENTITY.contactEmail}`)
  lines.push(`${t.country}: ${LEGAL_ENTITY.country}`)
  return lines
}

/**
 * Flip to true once a qualified lawyer has reviewed the wording AND the entity
 * details above are filled in. Until then every legal page carries a banner
 * saying the document is a draft under review — which is the honest state, and
 * far better than silently presenting unreviewed text as binding.
 */
export const LEGAL_REVIEWED = false

/** The trading name to use in prose until a legal name is registered. */
export function entityName(): string {
  return LEGAL_ENTITY.legalName ?? LEGAL_ENTITY.product
}
