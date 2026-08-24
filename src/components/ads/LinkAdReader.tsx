'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowUpRight, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { clickAdLink, startAd, type SubmitAdResult } from '@/app/[locale]/(app)/ads/actions'
import { Button } from '@/components/ui/Button'
import { usableCtaLinks } from '@/lib/ads/cta'
import type { FeedAd } from '@/lib/ads/data'
import { cn } from '@/lib/cn'

import { AdDisclosure } from './AdDisclosure'
import { AdResult } from './AdResult'
import { LeaveAdDialog, LeaveBar, LeaveFact } from './LeaveAdDialog'

/**
 * A LINK ad: an article to read, then one link out to the advertiser.
 *
 * ITS OWN SURFACE, NOT A THIRD BRANCH OF AdPlayer. The player is built around
 * a timeline and a question sheet — cue points, answer collection, retries,
 * a video that must stay mounted while a sheet is open. A link ad has none of
 * that: no video, no questions, no answers to hold back. Threading a third
 * format through eight hundred lines of that would make both harder to read
 * and neither safer. What the two DO share is where it matters — the result
 * card, the disclosure, and the server function that decides on the money.
 *
 * THE READING TIME IS THE WHOLE DEFENCE, and it is why the button is not a
 * link until the clock runs out. A video makes somebody sit through it and
 * answer a question about it; a survey makes them type. This asks for one tap,
 * and there is no way to observe whether the article was read — so the seconds
 * before the tap counts are all there is, and they are enforced by
 * `submit_ad_answers` against a stamp the server wrote, not by this clock.
 *
 * The clock here starts when `startAd` ANSWERS, which is strictly after the
 * server started counting. So it is always the more conservative of the two:
 * the user may wait a fraction longer than the database requires, but they can
 * never be told "too fast" by a screen that said they were ready.
 *
 * THE TAP AND THE CREDIT HAPPEN TOGETHER, and the navigation is not awaited.
 * It is a real `<a target="_blank">` rather than a button that opens a window
 * after a server round trip — a popup blocker eats the second kind, and being
 * paid but not taken to the advertiser is the one outcome that helps nobody.
 */

type Phase = 'starting' | 'unavailable' | 'reading' | 'submitting' | 'result'

export function LinkAdReader({
  ad,
  nextAd,
  nextAdCount,
  onClose,
  onNextAd,
  onResolved,
}: {
  ad: FeedAd
  /** The ad that would come next inside today's allowance, or null. */
  nextAd: FeedAd | null
  /** Remaining count of ads in the next format category. */
  nextAdCount?: number
  onClose: () => void
  onNextAd: (targetAd?: FeedAd) => void
  onResolved: (adId: string, result: SubmitAdResult) => void
}) {
  const t = useTranslations('ads')

  const [phase, setPhase] = useState<Phase>('starting')
  const [result, setResult] = useState<SubmitAdResult | null>(null)
  const minReadSeconds = ad.minWatchSeconds ?? 10
  /** Seconds of reading still required. Seeded from the ad, ticked locally. */
  const [remaining, setRemaining] = useState(minReadSeconds)
  /** Bumped by a retry, which re-registers the view and restarts the clock. */
  const [runKey, setRunKey] = useState(0)
  /** The "leave this ad?" dialog — the same one a video and a survey show. */
  const [confirmingClose, setConfirmingClose] = useState(false)

  /* Read synchronously by the click handler: two taps 100ms apart would
     otherwise both fire the server call before React re-rendered. The second
     one is harmless — the database returns `already_completed` — but it would
     spend a round trip and flash a second result card. */
  const clickedRef = useRef(false)

  const destination = usableCtaLinks(ad.ctaLinks)[0] ?? null

  // ---- Register the view, which starts the server's clock ----------------
  useEffect(() => {
    let cancelled = false
    startAd(ad.id).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setPhase('unavailable')
        return
      }
      setRemaining(minReadSeconds)
      setPhase('reading')
    })
    return () => {
      cancelled = true
    }
  }, [ad.id, minReadSeconds, runKey])

  // ---- The reading countdown ---------------------------------------------
  useEffect(() => {
    if (phase !== 'reading' || confirmingClose || remaining <= 0) return
    const id = setInterval(() => setRemaining((s) => Math.max(s - 1, 0)), 1000)
    return () => clearInterval(id)
  }, [phase, confirmingClose, remaining])

  /**
   * Whether leaving now would throw something away.
   *
   * The reading clock is the same kind of progress a video's watch time is:
   * `register_ad_view` restarts it from zero on the next open, so somebody
   * twelve seconds into a fifteen-second read genuinely loses those twelve
   * seconds. Operator, 2026-07-31: the X here "just takes you to the ads tab"
   * while a video and a survey stop to say what leaving costs — so it asks
   * now, in the same words and the same dialog.
   *
   * Nothing to lose means no dialog: before the clock has moved, or once the
   * points are already paid, leaving costs nothing and a confirmation would
   * only teach people to dismiss confirmations without reading them.
   */
  const secondsRead = Math.max(minReadSeconds - remaining, 0)
  const hasProgress = phase === 'reading' && secondsRead > 0

  const requestClose = useCallback(() => {
    if (!hasProgress) {
      onClose()
      return
    }
    setConfirmingClose(true)
  }, [hasProgress, onClose])

  // The overlay owns the screen, so the page behind it must not scroll, and
  // Escape asks exactly what the X asks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // While the dialog is up, Escape is "stay" — the conventional cancel.
      if (confirmingClose) {
        setConfirmingClose(false)
        return
      }
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [confirmingClose, requestClose])

  const claim = useCallback(() => {
    if (clickedRef.current) return
    clickedRef.current = true
    setPhase('submitting')
    clickAdLink(ad.id).then((res) => {
      setResult(res)
      setPhase('result')
      onResolved(ad.id, res)
    })
  }, [ad.id, onResolved])

  /** Start the read again — offered by the result card when the attempt was
   *  refused for a reason that can pass, and the server's stamp has to be
   *  rewritten before another click can count. */
  const retry = useCallback(() => {
    clickedRef.current = false
    setResult(null)
    setPhase('starting')
    setRunKey((k) => k + 1)
  }, [])

  const ready = remaining <= 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ad.title}
      className="fixed inset-0 z-50 flex flex-col bg-canvas"
    >
      {/* ---- Top bar ------------------------------------------------------
          z-40 keeps the way out above the result card's backdrop (z-30). The
          player had these tied at z-20, and the backdrop — later in the DOM —
          won: the X did nothing at all once an ad had been graded. */}
      <header className="relative z-40 flex shrink-0 items-center gap-3 border-b border-ink-200 bg-surface px-3 py-3 text-ink-900 sm:px-5">
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('player.close')}
          className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none"
        >
          <X aria-hidden className="size-5" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-semibold">{ad.title}</p>
          <p className="truncate text-[0.75rem] text-ink-500">
            {ad.advertiser ?? t('card.sponsored')}
          </p>
        </div>

        <span className="shrink-0 rounded-full border border-success-500/25 bg-success-50 px-2.5 py-1 text-[0.75rem] font-bold text-success-700 tabular-nums">
          {t('card.reward', { points: ad.points })}
        </span>
      </header>

      {/* ---- The article -------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {phase === 'starting' && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-ink-500">
            <Loader2 aria-hidden className="size-6 animate-spin" />
            <p className="text-[0.8125rem]">{t('player.loading')}</p>
          </div>
        )}

        {phase === 'unavailable' && (
          <div className="mx-auto flex max-w-[26rem] flex-col items-center gap-4 px-6 py-16 text-center">
            <p className="text-[0.9375rem] font-semibold text-ink-900">
              {t('player.unavailableTitle')}
            </p>
            <p className="text-[0.8125rem] text-ink-500">{t('player.unavailableBody')}</p>
            <Button onClick={onClose}>{t('result.done')}</Button>
          </div>
        )}

        {phase !== 'starting' && phase !== 'unavailable' && (
          /* A measure of about 70 characters, centred. This is the one screen
             in the app somebody is asked to actually READ, and a paragraph
             running the full width of a tablet is what makes people stop. */
          <article className="mx-auto w-full max-w-[42rem] px-4 py-6 sm:px-6 sm:py-8">
            <h1 className="text-[1.25rem] leading-snug font-semibold tracking-[-0.01em] text-ink-900 sm:text-[1.5rem]">
              {ad.title}
            </h1>
            {ad.description && (
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-500">{ad.description}</p>
            )}

            {/* The advertiser's own line breaks are kept. They wrote it in a
                textarea and the paragraphs are theirs to place. */}
            <div className="mt-5 flex flex-col gap-4">
              {paragraphs(ad.articleBody).map((para, i) => (
                <p
                  key={i}
                  className="text-[0.9375rem] leading-[1.75] whitespace-pre-wrap text-ink-700"
                >
                  {para}
                </p>
              ))}
            </div>
          </article>
        )}
      </div>

      {/* ---- The link, and what it is worth --------------------------------
          Fixed at the bottom rather than at the end of the article: on a long
          piece it would be below the fold, and a user who has read enough
          should never have to scroll to find the thing they are being paid
          for. It is also where the disclosure belongs — beside the control
          that leaves the app, not in a header somebody scrolled past. */}
      {(phase === 'reading' || phase === 'submitting' || phase === 'result') && (
        <div className="shrink-0 border-t border-ink-200 bg-surface px-4 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto w-full max-w-[42rem]">
            {destination ? (
              ready ? (
                <a
                  href={destination.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={claim}
                  className={cn(
                    'inline-flex h-12 w-full items-center justify-center gap-2 rounded-(--radius-input)',
                    'bg-brand-600 text-[0.9375rem] font-semibold text-white',
                    'transition-colors hover:bg-brand-700',
                    'focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:outline-none',
                  )}
                >
                  {ad.ctaLabel?.trim() || t('link.visit')}
                  <ArrowUpRight aria-hidden className="size-4 shrink-0 opacity-80" />
                </a>
              ) : (
                /* Deliberately a real disabled control with a live countdown,
                   not a link that pays nothing. Letting somebody tap through
                   early would send them to the advertiser having earned
                   nothing — and they would never know why. */
                <div
                  aria-live="polite"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-(--radius-input) border border-ink-200 bg-ink-100 text-[0.875rem] font-semibold text-ink-700 dark:border-ink-300 dark:text-ink-300 tabular-nums"
                >
                  {t('link.waiting', { seconds: remaining })}
                </div>
              )
            ) : (
              /* The database will not accept a link ad without a destination,
                 so this is unreachable in practice — but a screen whose whole
                 purpose is one button must say something if it is missing,
                 rather than rendering a blank bar. */
              <p className="py-2 text-center text-[0.8125rem] text-ink-500">
                {t('link.noDestination')}
              </p>
            )}

            <p className="mt-2 text-center text-[0.75rem] text-ink-500">
              {ready ? t('link.readyHint', { points: ad.points }) : t('link.waitingHint')}
            </p>

            <AdDisclosure className="mt-2.5" />
          </div>
        </div>
      )}

      {/* ---- Leaving mid-read ---------------------------------------------
          The same dialog a video and a survey put up, with the reading clock
          in place of watch time and answers. */}
      {confirmingClose && (
        <LeaveAdDialog
          body={t('leave.bodyLink')}
          note={t('leave.noCostLink')}
          onStay={() => setConfirmingClose(false)}
          onLeave={onClose}
          progress={
            <>
              <LeaveFact className="mt-1.5">
                {t('leave.read', { seconds: secondsRead, total: minReadSeconds })}
              </LeaveFact>
              <LeaveBar fraction={secondsRead / Math.max(minReadSeconds, 1)} />
            </>
          }
        />
      )}

      {/* ---- Claiming, and the outcome ------------------------------------ */}
      {(phase === 'submitting' || phase === 'result') && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 p-4 md:p-6">
          <div className="w-full max-w-[26rem] rounded-(--radius-panel) bg-surface shadow-[0_16px_48px_-12px_rgb(15_23_42/0.5)]">
            {phase === 'submitting' ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-ink-500">
                <Loader2 aria-hidden className="size-6 animate-spin text-brand-600" />
                <p className="text-[0.8125rem]">{t('link.claiming')}</p>
              </div>
            ) : (
              result && (
                <AdResult
                  result={result}
                  format="link"
                  ad={ad}
                  nextAd={nextAd}
                  nextAdCount={nextAdCount}
                  onNext={onClose}
                  onRetry={retry}
                  onNextAd={nextAd ? () => onNextAd(nextAd) : undefined}
                />
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** The article split on blank lines, so the advertiser's paragraphs survive.
 *  A single body of text with no blank lines comes back as one paragraph,
 *  which `whitespace-pre-wrap` still renders with its own line breaks. */
function paragraphs(body: string | null): string[] {
  if (!body) return []
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}
