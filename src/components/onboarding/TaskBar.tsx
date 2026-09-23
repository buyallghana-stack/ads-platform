'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTranslations } from 'next-intl'

import { useMounted } from '@/components/onboarding/use-mounted'
import { Button } from '@/components/ui/Button'

/**
 * A step that asks the member to DO something, without taking the app away
 * from them.
 *
 * ⚠️ THIS EXISTS BECAUSE THE SPOTLIGHT WAS WRONG FOR THESE STEPS. "Watch an
 * ad" was rendered as a dimmed screen with a hole around the first card, so
 * the surveys tab, every other card and the video player itself were all
 * underneath a shade that swallowed taps. The step could not be completed, the
 * bubble sat on "waiting" for ever, and the app read as frozen. The same was
 * true of the payout form and the PIN pad, which are multi-field screens that
 * cannot be used through a hole the size of one element.
 *
 * So an action step dims NOTHING and blocks NOTHING. It is a bar along the
 * bottom stating the task and the progress, and it disappears on its own when
 * the database says the thing is done. The member uses the real app to do a
 * real thing, which is the entire point of the step.
 *
 * It sits above the tab bar (`z-40`) but below a modal, so the ad player opens
 * over it rather than under it.
 */
export function TaskBar({
  title,
  body,
  index,
  total,
  busy = false,
  /** Offered only when the step cannot be finished, such as an empty ad pool. */
  onNext,
  onSkip,
}: {
  title: string
  body: string
  index: number
  total: number
  busy?: boolean
  onNext?: () => void
  onSkip: () => void
}) {
  const t = useTranslations('onboarding')
  const mounted = useMounted()

  /*
    ── OUT OF THE WAY WHILE THEY ARE TYPING ──────────────────────────────────

    ⚠️ REPORTED ON THE PAYOUT STEP: the bar sat over the account-name field and
    the Save button, so the member could not see what they were typing and
    could not reach the control that finishes the very step being asked for.
    A prompt that blocks the task it is prompting for is worse than no prompt.

    So it steps aside whenever a field has focus. On a phone the keyboard is
    covering that part of the screen anyway, and the instruction has already
    been read by the time somebody starts filling the form in. It returns the
    moment focus leaves, so the progress and the way out are never lost.
  */
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    const isField = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT')

    const onFocus = (e: FocusEvent) => {
      if (isField(e.target)) setTyping(true)
    }
    const onBlur = (e: FocusEvent) => {
      /* Moving between two fields must not flash the bar back in. */
      if (isField(e.target) && !isField(e.relatedTarget)) setTyping(false)
    }

    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
    }
  }, [])

  // Portals only after mount; see `useMounted`.
  if (!mounted) return null

  return createPortal(
    <div
      role="status"
      className={[
        /* z-40 matches the tab bar and is BELOW the ad player and the link
           reader at z-50, so opening an ad covers this bar rather than
           fighting it. Portalled to the body, so it paints over the tab bar
           at the same level. */
        'fixed inset-x-0 bottom-0 z-40 transition-transform duration-200',
        /* Slid away rather than unmounted, so it does not reflow the page
           under the member's thumb every time a field takes focus. */
        typing ? 'pointer-events-none translate-y-[130%]' : 'translate-y-0',
        // Clears the bottom tab bar on mobile, sits on the floor on desktop.
        'pb-[calc(env(safe-area-inset-bottom)+4.25rem)] md:pb-[env(safe-area-inset-bottom)]',
        'px-3 pt-3',
      ].join(' ')}
    >
      <div className="mx-auto w-full max-w-2xl rounded-(--radius-panel) border border-brand-600/30 bg-surface p-4 shadow-[0_12px_40px_-12px_rgb(15_23_42/0.35)]">
        <div className="flex items-start gap-3">
          {/* A live dot rather than a spinner. A spinner says the app is
              working; this is waiting on the person, not on the server. */}
          <span aria-hidden className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center">
            <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-brand-600/60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-brand-600" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand-700">
              {t('progress', { index, total })}
            </p>
            <p className="mt-0.5 text-[0.875rem] font-bold leading-snug text-ink-900">{title}</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-600">{body}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t('skip')}
          </Button>
          {onNext && (
            <Button variant="secondary" size="sm" onClick={onNext} loading={busy}>
              {t('later')}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
