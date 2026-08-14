import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import middleware from '@/middleware'

// Mock next-intl/middleware and Supabase to run cleanly in Node environment
vi.mock('next-intl/middleware', () => ({
  default: () => () => new (require('next/server').NextResponse)(),
}))

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockImplementation((_req, res) => Promise.resolve(res)),
}))

describe('Ghana-only Geo Restriction (§6.9)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  it('has identical regionUnavailable keys in en and fr translation files', () => {
    const en = JSON.parse(readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'))
    const fr = JSON.parse(readFileSync(join(process.cwd(), 'messages/fr.json'), 'utf8'))

    expect(en.regionUnavailable).toBeDefined()
    expect(fr.regionUnavailable).toBeDefined()

    const enKeys = Object.keys(en.regionUnavailable).sort()
    const frKeys = Object.keys(fr.regionUnavailable).sort()

    expect(enKeys).toEqual(frKeys)
  })

  it('allows all requests when GEO_RESTRICTION_ENABLED is false', async () => {
    process.env.GEO_RESTRICTION_ENABLED = 'false'

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { 'x-vercel-ip-country': 'US' },
    })

    const res = await middleware(req)
    // When not redirected to unavailable, status is 200 or intl rewrite
    expect(res.headers.get('location')).toBeNull()
  })

  it('allows Ghana requests (GH) when GEO_RESTRICTION_ENABLED is true', async () => {
    process.env.GEO_RESTRICTION_ENABLED = 'true'

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { 'x-vercel-ip-country': 'GH' },
    })

    const res = await middleware(req)
    expect(res.headers.get('location')).toBeNull()
  })

  it('redirects non-Ghana requests (US) to /unavailable when enabled', async () => {
    process.env.GEO_RESTRICTION_ENABLED = 'true'

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: { 'x-vercel-ip-country': 'US' },
    })

    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/unavailable')
  })

  it('redirects non-Ghana requests on French routes to /fr/unavailable when enabled', async () => {
    process.env.GEO_RESTRICTION_ENABLED = 'true'

    const req = new NextRequest('http://localhost:3000/fr/dashboard', {
      headers: { 'x-vercel-ip-country': 'GB' },
    })

    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/fr/unavailable')
  })

  it('does not redirect requests that are already on /unavailable', async () => {
    process.env.GEO_RESTRICTION_ENABLED = 'true'

    const req = new NextRequest('http://localhost:3000/unavailable', {
      headers: { 'x-vercel-ip-country': 'US' },
    })

    const res = await middleware(req)
    // Should not redirect to itself
    expect(res.headers.get('location')).toBeNull()
  })
})
