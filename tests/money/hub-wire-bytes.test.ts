import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  HUB_REQUEST_ID_HEADER,
  HUB_SIGNATURE_HEADER,
  HUB_TIMESTAMP_HEADER,
  hubSignature,
  verifyHubRequest,
} from '@/lib/payments/hub/sign'

/**
 * The bytes that actually leave this app, caught on the wire.
 *
 * WHY THIS FILE EXISTS. `hub-signing.test.ts` signs with `signHubRequest` and
 * verifies with `verifyHubRequest`, so it proves this app agrees with itself.
 * It cannot prove that the string it signs is the string the hub hashes, and
 * it cannot see the request body at all, because the body is built inside
 * `hubInitialise` and never handed to the signer's tests.
 *
 * The Tech Store put it plainly on 17 September 2026: their signing test and
 * ours were written separately from the same prose, neither has ever seen a
 * byte the other produced, and both would still pass if the two
 * implementations had drifted. The only thing proving the pair agrees is that
 * live traffic works, which proves they agreed on the day somebody looked.
 *
 * So this runs the REAL `hubInitialise` and the REAL `hubPaymentStatus`
 * against a socket, keeps what arrived, and asserts on that rather than on
 * anything a test constructed. It is also how the capture they asked for is
 * produced:
 *
 *     HUB_CAPTURE=1 npx vitest run tests/money/hub-wire-bytes.test.ts
 *
 * signs with the real `HUB_OUTBOUND_SECRETS` from `.env.local` and writes
 * `docs/hub-signing-capture.json` for them to commit as a fixture. Without the
 * flag it signs with the dummy secret below and writes nothing, so an ordinary
 * run needs no credentials and changes no files.
 */

vi.mock('server-only', () => ({}))

const DUMMY = 'a-secret-that-is-long-enough-to-be-real'

const realSecrets = (process.env.HUB_OUTBOUND_SECRETS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

/* Capturing means signing with the secret the Tech Store actually holds, so
   the fixture verifies on their side. An HMAC tag reveals nothing about the
   key that made it, which is what makes publishing one safe; the key itself
   never leaves this process. */
const capturing = process.env.HUB_CAPTURE === '1' && realSecrets.length > 0
const secrets = capturing ? realSecrets : [DUMMY]

/* The one thing under test is the body and the headers, so the URL is the
   only thing mocked. `requireHubConfig` is otherwise exactly what production
   calls. */
vi.mock('@/lib/env', () => ({
  requireHubConfig: () => ({ url: base, secrets }),
  hubSecrets: () => secrets,
}))

type Caught = {
  method: string
  url: string
  headers: Record<string, string>
  /** The raw request body, byte for byte, before anything parses it. */
  body: string
}

let server: Server
let base = ''
const caught: Caught[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      caught.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
        ),
        body: Buffer.concat(chunks).toString('utf8'),
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        req.method === 'POST'
          ? JSON.stringify({
              reference: 'TS-9F4C2A7B61E8',
              authorization_url: 'https://checkout.paystack.com/abc123',
              reused: false,
            })
          : JSON.stringify({
              reference: 'TS-9F4C2A7B61E8',
              external_ref: '7c2f8e10-0000-4000-8000-0000000000aa',
              status: 'success',
              amount_minor: 52000,
              currency: 'GHS',
              paid_at: '2026-09-16T01:42:11Z',
            }),
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The capture server took no port.')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** Imported after the mock and after `base` exists, which is why it is not at the top. */
const { hubInitialise, hubPaymentStatus } = await import('@/lib/payments/hub/client')

const INPUT = {
  externalRef: '7c2f8e10-0000-4000-8000-0000000000aa',
  amountMinor: 52000,
  currency: 'GHS',
  customerEmail: 'capture@sideperks.org',
  returnUrl: 'https://sideperks.org/payments/return',
}

describe('what hubInitialise puts on the wire', () => {
  let post: Caught

  beforeAll(async () => {
    const result = await hubInitialise(INPUT)
    expect(result).toMatchObject({ ok: true })
    post = caught.find((c) => c.method === 'POST')!
  })

  it('posts to the path in the contract', () => {
    expect(post.url).toBe('/api/internal/hub/payments/initialize')
  })

  /*
    ⚠️ A LITERAL, INCLUDING FIELD ORDER. `JSON.stringify` writes keys in
    insertion order, the signature covers the exact bytes, and the hub hashes
    what it receives. Reordering the object literal in `hubInitialise` is
    therefore a wire change, not a tidy-up, and it would pass every other test
    in this repository.
  */
  it('sends exactly these bytes', () => {
    expect(post.body).toBe(
      '{"external_ref":"7c2f8e10-0000-4000-8000-0000000000aa","amount_minor":52000,' +
        '"currency":"GHS","customer_email":"capture@sideperks.org",' +
        '"return_url":"https://sideperks.org/payments/return"}',
    )
  })

  it('carries the three signed headers', () => {
    expect(post.headers[HUB_TIMESTAMP_HEADER]).toMatch(/^\d{10}$/)
    expect(post.headers[HUB_REQUEST_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(post.headers[HUB_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/)
    expect(post.headers['content-type']).toBe('application/json')
  })

  /* The receiving half, run over bytes it did not produce. This is the closest
     this repository can get on its own to the exchange of fixtures. */
  it('signs what it sent, checked by the verifier over the received bytes', () => {
    expect(
      verifyHubRequest({
        secrets,
        timestamp: post.headers[HUB_TIMESTAMP_HEADER]!,
        requestId: post.headers[HUB_REQUEST_ID_HEADER]!,
        signature: post.headers[HUB_SIGNATURE_HEADER]!,
        body: post.body,
      }),
    ).toMatchObject({ ok: true })
  })

  it('signs with the FIRST secret, which is what the capture claims', () => {
    expect(post.headers[HUB_SIGNATURE_HEADER]).toBe(
      hubSignature(
        secrets[0]!,
        Number(post.headers[HUB_TIMESTAMP_HEADER]),
        post.headers[HUB_REQUEST_ID_HEADER]!,
        post.body,
      ),
    )
  })
})

describe('what hubPaymentStatus puts on the wire', () => {
  let get: Caught

  beforeAll(async () => {
    await hubPaymentStatus('TS-9F4C2A7B61E8')
    get = caught.find((c) => c.method === 'GET')!
  })

  it('asks for the reference, url encoded', () => {
    expect(get.url).toBe('/api/internal/hub/payments/TS-9F4C2A7B61E8')
  })

  /* A GET has no body and signs over the empty string. If it ever signed
     "undefined" the hub would refuse every status read, and the return page
     would show a paid buyer a spinner. */
  it('sends no body and signs over the empty string', () => {
    expect(get.body).toBe('')
    expect(get.headers[HUB_SIGNATURE_HEADER]).toBe(
      hubSignature(
        secrets[0]!,
        Number(get.headers[HUB_TIMESTAMP_HEADER]),
        get.headers[HUB_REQUEST_ID_HEADER]!,
        '',
      ),
    )
  })

  it('does not send a content type it has no body for', () => {
    expect(get.headers['content-type']).toBeUndefined()
  })
})

/*
  The file the Tech Store asked for. Written only under HUB_CAPTURE=1, and the
  assertions above have already run over these exact bytes, so what ships is
  what passed.
*/
describe('the capture', () => {
  it(capturing ? 'is written for the Tech Store' : 'is skipped without HUB_CAPTURE=1', () => {
    if (!capturing) {
      expect(realSecrets.length >= 0).toBe(true)
      return
    }

    const post = caught.find((c) => c.method === 'POST')!
    const get = caught.find((c) => c.method === 'GET')!

    const describeOne = (c: Caught) => ({
      method: c.method,
      path: c.url,
      headers: {
        [HUB_TIMESTAMP_HEADER]: c.headers[HUB_TIMESTAMP_HEADER],
        [HUB_REQUEST_ID_HEADER]: c.headers[HUB_REQUEST_ID_HEADER],
        [HUB_SIGNATURE_HEADER]: c.headers[HUB_SIGNATURE_HEADER],
        ...(c.headers['content-type'] ? { 'content-type': c.headers['content-type'] } : {}),
      },
      raw_body: c.body,
      raw_body_bytes: Buffer.byteLength(c.body, 'utf8'),
      signing_material: `${c.headers[HUB_TIMESTAMP_HEADER]}.${c.headers[HUB_REQUEST_ID_HEADER]}.${c.body}`,
    })

    const file = join(process.cwd(), 'docs', 'hub-signing-capture.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify(
        {
          note:
            'Captured from SidePerks hubInitialise and hubPaymentStatus on a loopback socket, ' +
            'not hand written. raw_body is the exact string that was signed and sent, before ' +
            'any pretty printing. Verify with HMAC-SHA256 over signing_material.',
          produced_by: 'tests/money/hub-wire-bytes.test.ts, HUB_CAPTURE=1',
          produced_at: new Date().toISOString(),
          algorithm: 'hex HMAC-SHA256(secret, "<timestamp>.<request_id>.<raw body>")',
          secret_position: 0,
          secret_position_means:
            'The first entry of SidePerks HUB_OUTBOUND_SECRETS, which is your HUB_INBOUND_SECRETS. ' +
            'Newest first, so position 0 is the current one.',
          initialize: describeOne(post),
          status_read: describeOne(get),
        },
        null,
        2,
      ) + '\n',
    )

    expect(post.body.length).toBeGreaterThan(0)
  })
})
