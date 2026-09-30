import { describe, expect, it } from 'vitest'

import { evmChecksumOk } from '@/lib/crypto/evm-address'

/**
 * EIP-55 checksums, checked when a member saves a wallet address.
 *
 * The broken address is the one the PayLink test run used on 30 September
 * 2026: one letter's case flipped. PayLink refused it after an admin had
 * approved the withdrawal; now it is refused at the moment it is typed.
 */
describe('EVM address checksums', () => {
  it('accepts correctly checksummed addresses', () => {
    expect(evmChecksumOk('0x417CC2ABa39275a2184B942B554aA20a670135Ba')).toBe(true)
    // The EIP-55 spec's own examples.
    expect(evmChecksumOk('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
    expect(evmChecksumOk('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')).toBe(true)
    expect(evmChecksumOk('0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB')).toBe(true)
    expect(evmChecksumOk('0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb')).toBe(true)
  })

  it('refuses a mixed-case address with one letter in the wrong case', () => {
    expect(evmChecksumOk('0x417cC2ABa39275a2184B942B554aA20a670135Ba')).toBe(false)
    expect(evmChecksumOk('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe(false)
  })

  it('leaves addresses with no checksum, and non-EVM ones, to the database', () => {
    expect(evmChecksumOk('0x417cc2aba39275a2184b942b554aa20a670135ba')).toBe(true)
    expect(evmChecksumOk('0x417CC2ABA39275A2184B942B554AA20A670135BA')).toBe(true)
    expect(evmChecksumOk('TXYZ1234567890abcdefghijkmnopqrstu')).toBe(true)
  })
})
