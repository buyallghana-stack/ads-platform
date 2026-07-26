/**
 * The advertiser's call to action: what they gave us, and the link it becomes.
 *
 * WHY THE HREF IS BUILT AND NEVER STORED
 * The database holds `{kind, value}` — a channel and whatever the advertiser
 * supplied, which might be "mtn.com.gh", "@mtnghana", "024 123 4567" or a full
 * URL. It does NOT hold an href. A stored href is a stored `javascript:` or
 * `data:` waiting for the day somebody pastes one into the admin form, and the
 * player would render it as a link the user taps. Building the href here from
 * a known channel means the product can only ever produce https, mailto, tel
 * or wa.me — there is no path through this file that emits anything else.
 *
 * It is also kinder to the operator: they paste what the advertiser sent them
 * in whatever shape it arrived, and this turns it into the right link.
 *
 * Surveys carry none of this. A survey is research, and pushing the
 * respondent to the advertiser's shop mid-questionnaire changes what the
 * answers mean — the database enforces it with a check constraint.
 */

export const CTA_KINDS = [
  'website',
  'whatsapp',
  'phone',
  'email',
  'instagram',
  'facebook',
  'x',
  'tiktok',
  'youtube',
  'linkedin',
] as const

export type CtaKind = (typeof CTA_KINDS)[number]

export type CtaLink = { kind: CtaKind; value: string }

/** Where a handle goes when it is not a full URL. */
const SOCIAL_HOST: Partial<Record<CtaKind, string>> = {
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  x: 'https://x.com/',
  tiktok: 'https://tiktok.com/@',
  youtube: 'https://youtube.com/@',
  linkedin: 'https://linkedin.com/in/',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Digits only, with Ghana's leading 0 turned into the country code. */
function msisdn(value: string): string | null {
  const raw = value.trim().replace(/[\s()-]/g, '')
  const digits = raw.replace(/^\+/, '')
  if (!/^\d{6,15}$/.test(digits)) return null
  // 024… is how a Ghanaian writes their own number; wa.me needs 23324….
  if (digits.startsWith('0')) return `233${digits.slice(1)}`
  return digits
}

/** An https URL, or null. Never any other protocol. */
function webUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  // A bare domain is what people paste. Anything that already declares a
  // protocol must declare one we allow.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // A host with no dot is not a site — it is a typo, or a scheme smuggled in.
  if (!url.hostname.includes('.')) return null

  url.protocol = 'https:'
  return url.toString()
}

/**
 * The link to open for this entry, or null when the value cannot be trusted.
 *
 * Callers must treat null as "do not render", never as "render it raw".
 */
export function ctaHref(link: CtaLink): string | null {
  const value = link.value.trim()
  if (!value) return null

  switch (link.kind) {
    case 'website':
      return webUrl(value)

    case 'whatsapp': {
      const number = msisdn(value)
      return number ? `https://wa.me/${number}` : webUrl(value)
    }

    case 'phone': {
      const number = msisdn(value)
      return number ? `tel:+${number}` : null
    }

    case 'email':
      return EMAIL.test(value) ? `mailto:${value}` : null

    default: {
      // A social entry is either a full link or a handle.
      if (/^https?:\/\//i.test(value) || value.includes('/')) return webUrl(value)
      const handle = value.replace(/^@/, '').trim()
      if (!/^[A-Za-z0-9._-]{1,60}$/.test(handle)) return null
      return `${SOCIAL_HOST[link.kind] ?? 'https://'}${handle}`
    }
  }
}

/** What is shown on the link when it is not the primary button. */
export function ctaDisplay(link: CtaLink): string {
  const value = link.value.trim()
  if (link.kind === 'website') {
    try {
      return new URL(webUrl(value) ?? '').hostname.replace(/^www\./, '')
    } catch {
      return value
    }
  }
  return value
}

/**
 * Why this entry cannot be saved, as a message key — or null when it is fine.
 * Shared by the admin form and the server action, so the two cannot disagree.
 */
export function ctaProblem(link: CtaLink): string | null {
  if (!link.value.trim()) return 'ctaValueMissing'
  if (!CTA_KINDS.includes(link.kind)) return 'ctaKindUnknown'
  return ctaHref(link) === null ? `ctaBad.${link.kind}` : null
}

/** The entries worth rendering: everything that resolves to a real link. */
export function usableCtaLinks(links: CtaLink[]): { link: CtaLink; href: string }[] {
  return links
    .map((link) => ({ link, href: ctaHref(link) }))
    .filter((entry): entry is { link: CtaLink; href: string } => entry.href !== null)
}
