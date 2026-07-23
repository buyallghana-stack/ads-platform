import 'server-only'

import { headers } from 'next/headers'

/**
 * Per-request signals the fraud layer needs (§7).
 *
 * Every value here is attacker-controlled to some degree, which is precisely
 * why they feed a risk SCORE rather than a hard decision. The IP is the only
 * one with real weight, and even that is shared by everyone behind a campus
 * or café connection — which is why §7 forbids hard-blocking on it.
 */
export async function getRequestContext() {
  const h = await headers()

  /*
    x-forwarded-for is a client-to-proxy chain and the client can prepend
    anything it likes, so the LEFTMOST entry is untrusted. On Vercel,
    x-real-ip is set by the platform and is the one to believe. The
    forwarded-for fallback exists for local development, where neither
    header is platform-set anyway.
  */
  const ip =
    h.get('x-real-ip')?.trim() ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null

  return {
    // Postgres inet rejects malformed input, so anything unparseable becomes
    // null rather than aborting a signup over a header.
    ip: isPlausibleIp(ip) ? ip : null,
    userAgent: h.get('user-agent')?.slice(0, 500) ?? null,
    // Set by Vercel's edge network. This is the geo signal §6.9 will enforce
    // on, and it costs nothing extra — no geolocation API call, no rate limit.
    country: normaliseCountry(h.get('x-vercel-ip-country')),
  }
}

function isPlausibleIp(value: string | null): value is string {
  if (!value) return false
  // Loose on purpose: Postgres does the real validation. This only keeps
  // obvious junk out of a query parameter.
  return /^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45
}

function normaliseCountry(value: string | null): string | null {
  if (!value) return null
  const upper = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(upper) ? upper : null
}
