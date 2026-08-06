'use client'

import { useState } from 'react'

import { Check, Copy, Info, Link2, Share2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cedis } from '@/lib/market/money'
import type { PromoteInfo } from '@/lib/market/data'
import { cn } from '@/lib/cn'

/**
 * What an affiliate sees before they promote something: what it pays, for how
 * long a click counts, when the money clears, and the link itself.
 *
 * ── THE LINK IS SHOWN, NOT JUST COPIED ──
 *
 * A button that copies something invisible is a button that can copy the wrong
 * thing and never be caught. The link is rendered in full, selectable, above
 * the copy button — so the affiliate can see their own code in it and confirm
 * the thing they are about to post everywhere is what they think it is. That
 * matters more here than in most places: a link missing its code pays nobody,
 * looks completely normal, and fails silently for however long it takes
 * somebody to notice they earned nothing.
 *
 * ── ALL FOUR REFUSALS GET THEIR OWN SENTENCE ──
 *
 * `reason` is never collapsed to a boolean. "You have not joined", "your
 * training is not finished", "your access has expired" and "this product needs
 * the professional programme" are four different situations with four
 * different next steps, and one greyed button covers none of them.
 */
export function PromotePanel({ info, url }: { info: PromoteInfo; url: string }) {
  const t = useTranslations('affiliate.promote')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* Clipboard refused — an insecure origin, or the user said no. The link
         is on screen and selectable, which is the fallback, so there is
         nothing useful to announce. */
    }
  }

  const share = async () => {
    if (!navigator.share) return copy()
    try {
      await navigator.share({ url })
    } catch {
      /* Dismissed. Not an error. */
    }
  }

  if (!info.canPromote) {
    return (
      <section
        id="promote"
        className="rounded-(--radius-panel) border border-ink-200 bg-ink-50 px-5 py-5"
      >
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink-900">
          <Info aria-hidden className="size-4.5 text-ink-400" />
          {t('cannot.title')}
        </h2>
        <p className="mt-2 max-w-lg text-[0.8125rem] leading-relaxed text-ink-600">
          {t(`cannot.${info.reason ?? 'no_account'}`)}
        </p>

        {/* The rate is still shown. It is what they would earn if they cleared
            the condition above, which is the entire argument for clearing it —
            hiding it makes the gate look arbitrary. */}
        {info.l1EarnMinor != null && (
          <p className="mt-3 text-[0.8125rem] text-ink-500">
            {t('cannot.wouldEarn', {
              amount: cedis(info.l1EarnMinor),
              rate: String(Number(info.l1Rate)),
            })}
          </p>
        )}
      </section>
    )
  }

  return (
    <section
      id="promote"
      className="rounded-(--radius-panel) border border-brand-600/30 bg-brand-50 px-5 py-5"
    >
      <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('title')}</h2>

      {/* What it pays. The cash is the big figure; the rate is context. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3">
          <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-ink-500">
            {t('youEarn')}
          </p>
          <p className="mt-1 text-[1.5rem] font-bold leading-none tabular-nums text-ink-900">
            {info.l1EarnMinor == null ? '—' : cedis(info.l1EarnMinor)}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-500">
            {t('rateOfPrice', {
              rate: String(Number(info.l1Rate ?? 0)),
              price: cedis(info.priceMinor ?? 0),
            })}
          </p>
        </div>

        {/* Level two only appears when it can actually be earned. A greyed
            "L2: —" on a beginner's screen advertises a thing they cannot have
            on the screen where they are trying to do the thing they can. */}
        {info.l2EarnMinor != null && (
          <div className="rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3">
            <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-ink-500">
              {t('secondLevel')}
            </p>
            <p className="mt-1 text-[1.5rem] font-bold leading-none tabular-nums text-ink-900">
              {cedis(info.l2EarnMinor)}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-500">
              {t('secondLevelHint', { rate: String(Number(info.l2Rate ?? 0)) })}
            </p>
          </div>
        )}
      </div>

      {/* The two rules that decide whether a click becomes money. Stated here
          rather than in terms nobody reads: they are the difference between
          "I shared it and got nothing" being a bug and being the rules. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[0.75rem]">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-ink-500">{t('window')}</dt>
          <dd className="font-semibold tabular-nums text-ink-900">
            {t('days', { n: info.windowDays ?? 30 })}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-ink-500">{t('hold')}</dt>
          <dd className="font-semibold tabular-nums text-ink-900">
            {info.holdDays ? t('days', { n: info.holdDays }) : t('immediate')}
          </dd>
        </div>
      </dl>

      {/* ── the link ────────────────────────────────────────────────── */}
      <div className="mt-4">
        <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-600">
          <Link2 aria-hidden className="size-3.5" />
          {t('yourLink')}
        </p>
        <p className="mt-1.5 select-all break-all rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink-800">
          {url}
        </p>

        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={copy}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-(--radius-input) px-4 py-2.5',
              'text-[0.875rem] font-semibold transition-colors',
              copied
                ? 'bg-success-500 text-white'
                : 'bg-brand-600 text-white hover:bg-brand-500',
            )}
          >
            {copied ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
            {copied ? t('copied') : t('copy')}
          </button>

          <button
            type="button"
            onClick={share}
            aria-label={t('share')}
            className="grid size-11 shrink-0 place-items-center rounded-(--radius-input) border border-ink-300 text-ink-700 transition-colors hover:border-brand-600 hover:text-brand-700"
          >
            <Share2 aria-hidden className="size-4" />
          </button>
        </div>

        {/* Live region: the button's own label changing is invisible to a
            screen reader that has already moved on. */}
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? t('copied') : ''}
        </span>
      </div>
    </section>
  )
}
