import { keccak_256 } from '@noble/hashes/sha3.js'

/**
 * Does a mixed-case EVM address carry a correct EIP-55 checksum?
 *
 * The checksum is the only protection a wallet address has against a typo:
 * the case of each letter encodes a hash of the address, so one wrong
 * character almost always breaks it. `set_payout_details` checks only the
 * shape (`0x` + 40 hex), so until the PayLink test run on 30 September 2026 a
 * mistyped address was saved happily and only refused later by PayLink,
 * after an admin had already approved the withdrawal.
 *
 * Returns true for anything that is not a mixed-case 0x address: an
 * all-lowercase or all-uppercase address carries no checksum to check, and a
 * non-EVM address (TRC-20) is the database's pattern to judge.
 */
export function evmChecksumOk(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return true
  const hex = address.slice(2)
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true

  const lower = hex.toLowerCase()
  const hash = keccak_256(new TextEncoder().encode(lower))
  for (let i = 0; i < 40; i++) {
    const c = hex[i]!
    if (!/[a-f]/i.test(c)) continue
    // Each hex character of the address maps to one nibble of the hash.
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f
    if ((nibble >= 8) !== (c === c.toUpperCase())) return false
  }
  return true
}
