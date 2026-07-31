import { Info } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * "We are not the advertiser, and what happens over there is not ours."
 *
 * Required by the operator's lawyer, 2026-07-31: every ad, and every time a
 * user arrives to watch, must carry a disclosure that SidePerks is not
 * affiliated with the advertisers and is not liable for money lost or for a
 * service that disappoints.
 *
 * IT MATTERS MOST ON LINK ADS, which is why it appears beside the button that
 * leaves the app rather than only in a header somebody scrolled past. A user
 * who taps through to an advertiser's site and is asked to pay for something
 * needs to have been told, on that screen, whose promise they are relying on.
 * A disclosure that lives only in the Terms is not a disclosure to somebody
 * about to spend money.
 *
 * Two tones because it appears in two places: on the app's own surfaces, and
 * over the black of the player where ink-* would be invisible.
 */
export function AdDisclosure({
  tone = 'surface',
  className,
}: {
  tone?: 'surface' | 'onDark'
  className?: string
}) {
  const t = useTranslations('ads')

  return (
    <p
      className={cn(
        'flex items-start gap-2 text-[0.6875rem] leading-relaxed',
        tone === 'onDark' ? 'text-white/60' : 'text-ink-500',
        className,
      )}
    >
      <Info
        aria-hidden
        className={cn('mt-px size-3.5 shrink-0', tone === 'onDark' ? 'text-white/50' : 'text-ink-400')}
      />
      <span>{t('disclosure')}</span>
    </p>
  )
}
