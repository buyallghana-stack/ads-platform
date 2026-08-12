import type { Metadata } from 'next'

import { CoverProbe } from '@/components/diag/CoverProbe'

export const metadata: Metadata = {
  title: 'Layout probe',
  robots: { index: false, follow: false },
}

/**
 * A page whose only job is to be opened on a phone nobody here has.
 *
 * The iPhone 7 has now defeated two rounds of reasoning at a distance: the
 * cover was fixed, the borders were fixed, and the operator's photograph still
 * shows a collapsed cover with the play disc on the title. Every tool available
 * here models that browser rather than being it, and a model that has been
 * wrong twice is not worth a third guess.
 *
 * So this renders the real cover markup, measures it in the browser that is
 * actually failing, and prints the numbers in text large enough to photograph.
 * Public and unauthenticated on purpose: the point is that it can be opened on
 * the device in one tap, with no keyboard and no login.
 *
 * Delete it once the phone is fixed. It is a probe, not a feature.
 */
export default function DiagPage() {
  return <CoverProbe />
}
