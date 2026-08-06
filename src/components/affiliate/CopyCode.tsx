'use client'

import { useState } from 'react'

import { Check, Copy, Hash } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * The affiliate code, and what it is for.
 *
 * ── THE CODE ALONE IS NOT ACTIONABLE ──
 *
 * Showing "TMGK4EYP" and a copy button assumes the reader knows what to do
 * with eight characters. They do not — the thing they need is a URL, and the
 * code is only the part of it that makes them money.
 *
 * But a bare link is not right either, because affiliate links here are
 * PRODUCT-SPECIFIC by schema: `affiliate_clicks.product_id` is NOT NULL, so
 * there is no generic "shop through my link" and a link to the catalogue would
 * record nothing. Building one here would hand somebody a link that looks
 * exactly like a working one and pays nothing.
 *
 * So this shows the code, explains in one line that the usable links come from
 * each product, and copies the code for people who want to paste it into a
 * conversation. Honest about what it is rather than convenient and wrong.
 */
export function CopyCode({
  code,
  origin,
  locale,
}: {
  code: string
  origin: string
  locale: string
}) {
  const t = useTranslations('affiliate.account')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* Refused. The code is on screen and selectable. */
    }
  }

  return (
    <section className="rounded-(--radius-panel) border border-brand-600/30 bg-brand-50 p-4">
      <p className="flex items-center gap-1.5 text-[0.75rem] font-medium uppercase tracking-[0.06em] text-ink-500">
        <Hash aria-hidden className="size-3.5" />
        {t('codeTitle')}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 select-all break-all rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2.5 font-mono text-[1rem] font-semibold tracking-[0.08em] text-ink-900">
          {code}
        </p>
        <button
          type="button"
          onClick={copy}
          aria-label={t('copyCode')}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-(--radius-input) transition-colors',
            copied ? 'bg-success-500 text-white' : 'bg-brand-600 text-white hover:bg-brand-500',
          )}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
        </button>
      </div>

      <p className="mt-2.5 text-[0.75rem] leading-relaxed text-ink-600">
        {t('codeHint', { example: `${origin}/${locale}/p/…?ref=${code}` })}
      </p>

      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </section>
  )
}
