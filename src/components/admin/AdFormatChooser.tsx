import { ArrowLeft, ArrowRight, Film, Link2, ListChecks } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import type { AdFormat } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

/**
 * Which of the three kinds of ad is being made.
 *
 * The formats are not variations on one thing — they buy different attention
 * and they defend themselves differently, which is what the third line on
 * each card says out loud. An operator picking "link" should know, at the
 * moment of picking, that there is no way to observe whether the article was
 * read; that is the honest framing and it is also the reason the reading time
 * exists.
 *
 * Server-rendered: three links and no state. The editor behind each one is
 * where the client work starts.
 */

const CARDS: { format: AdFormat; Icon: typeof Film; tone: string }[] = [
  // Brand blue is ads and watching, violet is questions, teal is the new one —
  // every accent on this platform carries a fixed meaning, so a format takes
  // a hue that is already free rather than inventing a sixth.
  { format: 'video', Icon: Film, tone: 'bg-brand-50 text-brand-600 ring-brand-600/15' },
  { format: 'survey', Icon: ListChecks, tone: 'bg-violet-50 text-violet-700 ring-violet-600/15' },
  { format: 'link', Icon: Link2, tone: 'bg-teal-50 text-teal-700 ring-teal-600/15' },
]

export function AdFormatChooser({ tier = null }: { tier?: string | null }) {
  const t = useTranslations('admin.ads.chooser')

  return (
    <div>
      <Link
        href="/admin/ads"
        className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {t('back')}
      </Link>

      <h1 className="mt-1.5 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.5rem]">
        {t('title')}
      </h1>
      <p className="mt-1 max-w-[60ch] text-[0.8125rem] leading-relaxed text-ink-500">
        {t('subtitle')}
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {CARDS.map(({ format, Icon, tone }) => (
          <Link
            key={format}
            /* The bucket rides through the format question. Pressing Add on
               the Bronze bucket and arriving at an untargeted ad two clicks
               later would undo the board entirely. */
            href={`/admin/ads/new?format=${format}${tier ? `&tier=${tier}` : ''}`}
            className={cn(
              'group flex flex-col rounded-(--radius-card) border border-ink-200 bg-surface p-4',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-ink-300 hover:shadow-[0_2px_10px_-2px_rgb(15_23_42/0.12)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
            )}
          >
            <span className={cn('grid size-10 place-items-center rounded-(--radius-input) ring-1', tone)}>
              <Icon aria-hidden className="size-5" />
            </span>

            <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">
              {t(`${format}.name`)}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">
              {t(`${format}.body`)}
            </p>

            {/* What the platform can actually observe, and therefore what the
                reward is really being paid for. */}
            <p className="mt-2.5 border-t border-ink-200 pt-2.5 text-[0.6875rem] leading-relaxed text-ink-400">
              {t(`${format}.proof`)}
            </p>

            <span className="mt-3 inline-flex items-center gap-1 text-[0.75rem] font-semibold text-brand-600">
              {t('choose')}
              <ArrowRight
                aria-hidden
                className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
