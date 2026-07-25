import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto'

import { generateSecret, generateURI, verify } from 'otplib'
import QRCode from 'qrcode'

import { requireTotpKey } from '@/lib/env'

/**
 * Two-factor authentication primitives.
 *
 * `server-only` is not decoration here: this module decrypts TOTP secrets, and
 * importing it from a client component must fail the BUILD rather than ship a
 * decryption routine (and the reachable shape of a key) to the browser.
 */

/** Shown in the authenticator app's account list. */
const ISSUER = 'SidePerks'

/**
 * Secrets are encrypted with AES-256-GCM rather than merely stored in a
 * service-role-only table. The table is already unreachable from any client,
 * so this buys one specific thing: a leaked database — a dump, a backup, a
 * read-replica mistake — still yields no usable second factors, because the
 * key lives in the app environment and never in Postgres.
 *
 * Format: base64( iv[12] || authTag[16] || ciphertext ). GCM's tag makes the
 * record tamper-evident; a modified ciphertext fails to decrypt instead of
 * quietly producing a wrong secret.
 */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', requireTotpKey(), iv)
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', requireTotpKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** A fresh base32 secret for a new enrolment. */
export function newSecret(): string {
  return generateSecret()
}

/** The otpauth:// URI an authenticator app expects behind the QR code. */
export function otpauthUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: ISSUER, label: accountLabel, secret })
}

/**
 * QR as a data URI so the page stays self-contained — no image route, no
 * external request, and nothing about the secret ever hits a CDN or a log.
 */
export async function qrDataUri(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
}

/**
 * Check a 6-digit code.
 *
 * A 30-second tolerance accepts the neighbouring steps either side, which is
 * what makes this usable on a phone whose clock has drifted a little — the
 * common support complaint when a system is strict about it. One step is the
 * standard allowance; wider starts meaningfully enlarging the guess space.
 *
 * (otplib 13 takes this as `epochTolerance` in SECONDS. It is not the `window`
 * step count of otplib 12 — passing `window` here silently does nothing.)
 */
export async function verifyCode(secret: string, token: string): Promise<boolean> {
  if (!/^[0-9]{6}$/.test(token)) return false
  const result = await verify({ secret, token, epochTolerance: 30 })
  return result.valid
}

/**
 * Backup codes.
 *
 * Crockford-style alphabet: no I, L, O, U, or digits 0/1 — the characters
 * people misread when copying a code off a screenshot or a scrap of paper.
 * Formatted XXXX-XXXX purely for transcription accuracy; the dash is stripped
 * before hashing and before comparison.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const BACKUP_CODE_COUNT = 10

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    let body = ''
    // randomInt is drawn from the CSPRNG and is free of the modulo bias a
    // naive Math.random()*len would introduce.
    for (let c = 0; c < 8; c++) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    codes.push(`${body.slice(0, 4)}-${body.slice(4)}`)
  }
  return codes
}

/** Canonical form for storage and comparison: no dashes, upper case. */
export function normaliseBackupCode(code: string): string {
  return code.replace(/[^0-9a-z]/gi, '').toUpperCase()
}
