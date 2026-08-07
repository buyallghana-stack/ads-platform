'use client'

import { useState } from 'react'

import { Check, Copy, Share2, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * Bringing other affiliates in.
 *
 * ── WHY THIS IS A LINK TO THE TRAINING, NOT A "JOIN" LINK ──
 *
 * Operator, 2026-08-07: affiliates need somewhere obvious to copy a link for
 * "prospective affiliates", and they earn when those people buy the course.
 *
 * `CopyCode` explains, correctly, that there is no generic affiliate link here
 * — `affiliate_clicks.product_id` is NOT NULL, so a link to the catalogue
 * records nothing and pays nobody. What was missing is that the TRAINING IS A
 * PRODUCT. A link to the training programme carrying somebody's code is a real,
 * attributable affiliate link, and the thing it sells is exactly what turns the
 * person clicking it into another affiliate. So this is not a new mechanism, it
 * is the existing one pointed at the right product and given a name.
 *
 * The rate shown is the programme's own level-one rate, read from the server,
 * never assumed here: a panel that advertises a percentage the ledger does not
 * pay is worse than no panel.
 */
export function RecruitPanel({
  programmes,
}: {
  programmes: { title: string; url: string; l1Rate: number | null; priceGhs: number }[]
}) {
  const t = useTranslations('affiliate.recruit')
  const [copied, setCopied] = useState<string | null>(null)

  if (programmes.length === 0) return null

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      /* Clipboard refused. The link is rendered in full and selectable. */
    }
  }

  const share = async (title: string, url: string) => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        /* Dismissed. Falls through to copying, which always works. */
      }
    }
    void copy(url)
  }

  return (
    <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-500/12 text-violet-600"
        >
          <UserPlus className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold text-ink-900">{t('title')}</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{t('body')}</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {programmes.map((p) => (
          <li key={p.url} className="rounded-(--radius-card) border border-ink-200 p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[0.875rem] font-semibold text-ink-900">{p.title}</p>
              {p.l1Rate !== null && (
                <p className="text-[0.8125rem] font-semibold tabular-nums text-success-600">
                  {t('youEarn', {
                    amount: `GHS ${((p.priceGhs * p.l1Rate) / 100).toFixed(2)}`,
                  })}
                </p>
              )}
            </div>

            {/* Rendered in full and selectable. A truncated affiliate link is
                one somebody copies by hand and gets wrong. */}
            <p className="mt-2 break-all rounded-(--radius-input) bg-ink-50 px-3 py-2 font-mono text-[0.75rem] text-ink-700">
              {p.url}
            </p>

            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copy(p.url)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-(--radius-input) px-3 py-2',
                  'text-[0.8125rem] font-semibold transition-colors',
                  copied === p.url
                    ? 'bg-success-500 text-white'
                    : 'bg-brand-600 text-white hover:bg-brand-500',
                )}
              >
                {copied === p.url ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <Copy aria-hidden className="size-4" />
                )}
                {copied === p.url ? t('copied') : t('copy')}
              </button>

              <button
                type="button"
                onClick={() => share(p.title, p.url)}
                className="inline-flex items-center gap-1.5 rounded-(--radius-input) border border-ink-200 px-3 py-2 text-[0.8125rem] font-semibold text-ink-800 transition-colors hover:border-ink-300"
              >
                <Share2 aria-hidden className="size-4" />
                {t('share')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-500">{t('note')}</p>
    </section>
  )
}
