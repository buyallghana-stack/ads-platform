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
 * Details only the operator can supply. Left null on purpose: inventing a
 * registered company name, number or address would put official-looking
 * details that do not exist in front of users, on documents meant to bind
 * them. The pages show a review banner until these are filled in.
 */
export const LEGAL_ENTITY = {
  product: 'SidePerks',
  /** TODO(operator): registered company name, e.g. "SidePerks Ltd". */
  legalName: null as string | null,
  /** TODO(operator): company registration number. */
  registrationNumber: null as string | null,
  /** TODO(operator): registered office address. */
  address: null as string | null,
  contactEmail: 'buyallghana@gmail.com',
  country: 'Ghana',
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
