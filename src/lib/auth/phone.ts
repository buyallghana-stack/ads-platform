/**
 * Phone numbers as the sign-in identity. Safe on client and server.
 *
 * ONE CANONICAL FORM: the local ten digits, `0241234567`. It is what
 * `public.normalise_phone` produces in the database, what the unique index on
 * verified phones compares, and the format mNotify's API documents. `+233 24…`,
 * `233 24…` and `024…` are the same line and must never become two accounts.
 */
export function normalisePhone(input: string): string {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('233')) digits = `0${digits.slice(3)}`
  return digits
}

/** `024 *** 4567`: enough for the owner to recognise, not enough to harvest. */
export function maskPhone(phone: string): string {
  const p = normalisePhone(phone)
  if (p.length !== 10) return p
  return `${p.slice(0, 3)} *** ${p.slice(6)}`
}

/** `024 123 4567`, for showing the owner their own number. */
export function formatPhone(phone: string): string {
  const p = normalisePhone(phone)
  if (p.length !== 10) return p
  return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`
}

/**
 * The email identity a phone-only account carries underneath.
 *
 * GoTrue still needs one: sign-in resolves the phone to it, and payments hand
 * an email to Paystack. It is random (never the phone, which would put a
 * credential into every system that sees the address) and on a domain we own,
 * so nothing is ever delivered to a stranger.
 */
export const SYNTHETIC_EMAIL_DOMAIN = 'members.sideperks.org'

export function syntheticEmail(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `m-${id}@${SYNTHETIC_EMAIL_DOMAIN}`
}

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`))
}

/** An email worth showing a person, or null for the generated kind. */
export function visibleEmail(email: string | null | undefined): string | null {
  return email && !isSyntheticEmail(email) ? email : null
}

/**
 * The contact line staff see under a member's name: a real email if the
 * account has one, else the sign-in phone, else nothing. A generated address
 * is noise to an admin and never shown.
 */
export function contactLine(email: string | null | undefined, phone?: string | null): string {
  return visibleEmail(email) ?? (phone ? formatPhone(phone) : '')
}
