import { describe, expect, it } from 'vitest'

import { isNightClosed } from '@/lib/payments/night-hours'

/** Manual mobile money is open 08:00 to 21:59 (operator, 2026-09-28). */
describe('manual payments close at night', () => {
  it('is closed from 22:00 through 07:59 and open from 08:00 through 21:59', () => {
    const closedHours = Array.from({ length: 24 }, (_, h) => h).filter((h) => isNightClosed(h, 22, 8))
    expect(closedHours).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 22, 23])
  })

  it('never closes when both hours are the same', () => {
    expect(Array.from({ length: 24 }, (_, h) => isNightClosed(h, 9, 9)).some(Boolean)).toBe(false)
  })

  it('handles a window that does not cross midnight', () => {
    expect(isNightClosed(1, 0, 6)).toBe(true)
    expect(isNightClosed(6, 0, 6)).toBe(false)
    expect(isNightClosed(23, 0, 6)).toBe(false)
  })
})
