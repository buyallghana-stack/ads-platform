'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Check, Clock, Loader2, Play, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  startAd,
  submitAd,
  type AdQuestion,
  type SubmitAdResult,
} from '@/app/[locale]/(app)/ads/actions'
import { Button } from '@/components/ui/Button'
import type { FeedAd } from '@/lib/ads/data'
import { hasBranching, nextDueQuestion, visibleQuestions } from '@/lib/ads/visibility'
import { cn } from '@/lib/cn'

import { AdCta } from './AdCta'
import { AdvertiserMark } from './AdvertiserMark'
import { AdResult } from './AdResult'
import { LeaveAdDialog, LeaveBar, LeaveFact } from './LeaveAdDialog'
import { QuestionSheet } from './QuestionSheet'
import { VideoStage } from './VideoStage'
import { AdDisclosure } from '@/components/ads/AdDisclosure'

/**
 * The watching surface: a full-screen overlay rather than its own route.
 *
 * A route change would unmount the feed, lose the scroll position and cost a
 * navigation on a slow connection every time someone opens an ad — and people
 * open a lot of them in a row. An overlay keeps the feed alive underneath, so
 * finishing an ad returns straight to where they were with one fewer card.
 *
 * It drives videos and surveys because they are the same transaction with the
 * timeline removed: a survey is a video ad whose questions all happen at
 * second zero. Sharing the component keeps answer collection and submission
 * identical for both. It does NOT drive link ads — those have no timeline and
 * no questions at all, and live in LinkAdReader for the reasons set out there.
 *
 * WHERE THE QUESTIONS COME FROM
 * -----------------------------
 * The admin sets a cue second per question (`show_at_seconds`). A question
 * with a cue interrupts playback at that second; a question without one is
 * asked when the video finishes. An ad may have many of either, or none at
 * all — a watch-only ad, which is credited on watch time alone. The player
 * takes no view on which arrangement is "normal": it renders what the admin
 * configured.
 *
 * WHY ANSWERS ARE HELD AND SENT ONCE
 * ----------------------------------
 * Grading is one server call for the whole ad. Sending answers one at a time
 * would tell a user which single question they got wrong, which is exactly the
 * information needed to brute-force a survey. So answers accumulate locally —
 * including the mid-roll ones — and go up together at the end.
 */

type Phase =
  | 'starting'
  | 'unavailable'
  | 'intro' // waiting for the tap that starts playback
  | 'playing'
  | 'question'
  | 'submitting'
  | 'result'

export function AdPlayer({
  ad,
  nextAd,
  nextAdCount,
  onClose,
  onNextAd,
  onResolved,
}: {
  ad: FeedAd
  /**
   * The ad that would come next, if the feed has one left within today's
   * allowance. Null hides the "next ad" button rather than showing a control
   * that lands on an empty feed.
   */
  nextAd: FeedAd | null
  /** Remaining count of ads in the next format category. */
  nextAdCount?: number
  onClose: () => void
  onNextAd: (targetAd?: FeedAd) => void
  /** Fired once the server has ruled on the attempt, so the feed can drop the
   *  card and move the counters. */
  onResolved: (adId: string, result: SubmitAdResult) => void
}) {
  const t = useTranslations('ads')
  const isVideo = ad.format === 'video'

  const [phase, setPhase] = useState<Phase>('starting')
  const [questions, setQuestions] = useState<AdQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [askedIds, setAskedIds] = useState<string[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [result, setResult] = useState<SubmitAdResult | null>(null)

  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(ad.durationSeconds ?? 0)
  /*
    Whether the player can actually be told to play yet.

    THIS IS A MOBILE AUTOPLAY RULE, NOT A COSMETIC ONE. A browser only honours
    playVideo() inside the gesture that asked for it. Tapping before YouTube has
    finished loading meant the tap was remembered and replayed from the player's
    own onReady callback instead, which is not a gesture, so the phone refused
    it — and because the tap had already moved us past 'intro', the overlay was
    gone and there was nothing left to tap. The ad simply never started.

    So the tap is not offered until the player is ready, which is what keeps
    playVideo() inside the gesture.
  */
  const [ready, setReady] = useState(false)
  /**
   * Set once the server has ruled, and never cleared except by a retry.
   *
   * The operator's objection: "I don't like the fact that users are
   * automatically made to leave the video ad screen once they answer all
   * questions." So finishing an ad no longer ends the session — the result
   * card offers to keep watching, and this flag is what makes that safe. Every
   * clock-driven branch below refuses to act once it is true, so a second
   * pass over a cue or a watch requirement cannot submit the ad twice.
   */
  const [credited, setCredited] = useState(false)
  /** The "leave this ad?" dialog. See requestClose below. */
  const [confirmingClose, setConfirmingClose] = useState(false)

  /* Guards a race the polling loop makes easy: two ticks 250ms apart can both
     see the same cue before React has re-rendered with the new askedIds, which
     would open the same question twice. A ref is read synchronously, so it
     cannot be stale. The same reason applies to the phase — the 4 Hz tick has
     to know whether a sheet is already up, and state would lag it. */
  const askedRef = useRef<Set<string>>(new Set())
  const submittedRef = useRef(false)
  const phaseRef = useRef<Phase>('starting')
  /* Answers waiting on the clock: every question is done but the admin's
     minimum watch time is not up yet, so playback continues and submission
     happens on the tick that satisfies it. */
  const pendingSubmitRef = useRef<Record<string, string> | null>(null)
  /*
    The film has run out. Tracked because "go back to the video" stops being a
    sane answer once it has: playVideo() on an ENDED player REWINDS it, on both
    sources, so returning to a finished film restarts the advert from zero.
    Kept as a ref AND state for the usual reason in this file — the ref is read
    inside callbacks that must not go stale, the state is what render may look
    at (see the submit label).
  */
  const endedRef = useRef(false)
  const [ended, setEnded] = useState(false)

  /*
    The server's rule, mirrored exactly (see submit_ad_answers): the required
    watch is min_watch_seconds, falling back to the full duration ONLY when the
    ad has no questions — with nothing to grade, time watched is the whole
    test. Mirroring it here is what stops the client submitting into a
    guaranteed 'too_fast'; the server still decides.
  */
  const requiredWatch = isVideo
    ? (ad.minWatchSeconds ?? 10)
    : (ad.minWatchSeconds ?? (ad.questionCount === 0 ? (ad.durationSeconds ?? 0) : 0))

  /*
    Is there any film left? The end event is the reliable half; the clock is
    the belt and braces, because a stream that stalls on its last frame can
    leave onEnded unfired, and "go back to the video" must not be the answer
    then either. A duration of 0 means the source never reported one, in which
    case only the event can say.
  */
  const filmOver = ended || (duration > 0 && elapsed >= duration - 1)

  const setPhaseNow = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  /*
    Skip logic. Recomputed from the answers so far on every render, because
    answering one question can reveal or hide later ones. The database does
    the same sum independently when grading — see lib/ads/visibility.ts.
  */
  const visible = useMemo(() => visibleQuestions(questions, answers), [questions, answers])
  const branching = useMemo(() => hasBranching(questions), [questions])

  const current = questions.find((q) => q.id === currentId) ?? null

  /** Questions with a cue, soonest first. */
  const cued = useMemo(
    () =>
      questions
        .filter((q) => q.showAtSeconds !== null)
        .sort((a, b) => (a.showAtSeconds ?? 0) - (b.showAtSeconds ?? 0)),
    [questions],
  )

  /* Bumped by a retry. A wrong answer clears the server's watch stamp, so
     retrying has to call register_ad_view again — re-running this effect is
     exactly that, and keeps one code path for "begin an attempt". */
  const [runKey, setRunKey] = useState(0)

  // ---- Start: register the view, then fetch the questions ----------------
  useEffect(() => {
    let cancelled = false
    startAd(ad.id).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setPhaseNow('unavailable')
        return
      }
      setQuestions(res.questions)
      // A survey has no timeline to wait through, so it opens on its first
      // question. A video waits for the tap that satisfies the browser's
      // autoplay rules.
      const first = res.questions[0]
      if (!isVideo && first) {
        setCurrentId(first.id)
        setPhaseNow('question')
      } else {
        setPhaseNow('intro')
      }
    })
    return () => {
      cancelled = true
    }
  }, [ad.id, isVideo, runKey, setPhaseNow])

  // ---- Submitting --------------------------------------------------------
  const submit = useCallback(
    (finalAnswers: Record<string, string>) => {
      if (submittedRef.current) return
      submittedRef.current = true
      setPhaseNow('submitting')
      submitAd(ad.id, finalAnswers).then((res) => {
        setResult(res)
        setCredited(res.outcome === 'correct')
        setPhaseNow('result')
        onResolved(ad.id, res)
      })
    },
    [ad.id, onResolved, setPhaseNow],
  )

  /** Put a question on screen. askedRef is added to synchronously because the
   *  4 Hz tick reads it, and state would lag behind by a render. */
  const openQuestion = useCallback(
    (question: AdQuestion) => {
      askedRef.current.add(question.id)
      setAskedIds([...askedRef.current])
      setCurrentId(question.id)
      setDraft('')
      setPhaseNow('question')
    },
    [setPhaseNow],
  )

  /** The questions these answers still leave to ask, in the admin's order. */
  const stillToAsk = useCallback(
    (collected: Record<string, string>) =>
      visibleQuestions(questions, collected).filter((q) => !askedRef.current.has(q.id)),
    [questions],
  )

  /** Questions still unanswered once the video is over. */
  const askNextPending = useCallback(
    (collected: Record<string, string>) => {
      const pending = stillToAsk(collected)[0]
      if (pending) {
        openQuestion(pending)
        return
      }
      submit(collected)
    },
    [openQuestion, stillToAsk, submit],
  )

  // ---- Playback ----------------------------------------------------------
  const handleTime = useCallback(
    (seconds: number) => {
      setElapsed(seconds)
      // Only act while actually playing; a tick can land after the question
      // sheet is already up, or after the ad has been submitted.
      if (phaseRef.current !== 'playing') return
      // Watching on after the credit: the clock still runs the progress bar,
      // but nothing may be submitted or asked again.
      if (submittedRef.current) return

      // The clock has caught up with the answers.
      const waiting = pendingSubmitRef.current
      if (waiting && seconds >= requiredWatch) {
        pendingSubmitRef.current = null
        submit(waiting)
        return
      }

      /*
        A watch-only ad has no cue to end on and no reliable end event: an
        admin may declare a 30-second spot on a video that runs for ten
        minutes, and waiting for onEnded would strand the user there. The watch
        requirement is the finish line, exactly as the server sees it.
      */
      if (!waiting && questions.length === 0 && requiredWatch > 0 && seconds >= requiredWatch) {
        submit({})
        return
      }

      const due = cued.find(
        (q) =>
          !askedRef.current.has(q.id) &&
          seconds >= (q.showAtSeconds ?? 0) &&
          visible.some((v) => v.id === q.id),
      )
      if (!due) return
      openQuestion(due)
    },
    [cued, openQuestion, questions.length, requiredWatch, submit, visible],
  )

  const handleEnded = useCallback(() => {
    /* Recorded before any early return: the film running out is a fact about
       the film, not about what the player happens to be showing. */
    endedRef.current = true
    setEnded(true)
    if (phaseRef.current !== 'playing') return
    /*
      Watching on after the credit — the film simply finishes, and NOTHING
      moves. It used to bring the result card back, which put a full-screen
      backdrop over the bar at the bottom at the exact moment the film ran
      out: somebody reaching for "Next ad" or "Done" there had their tap taken
      by the backdrop instead, and the button looked broken. The bar already
      carries what the card would say — the points earned and both ways on —
      so there is nothing to come back for.
    */
    if (submittedRef.current) return
    const waiting = pendingSubmitRef.current
    if (waiting) {
      pendingSubmitRef.current = null
      submit(waiting)
      return
    }
    askNextPending(answers)
  }, [answers, askNextPending, submit])

  // ---- Answering ---------------------------------------------------------
  function answerCurrent() {
    if (!current) return
    const collected = { ...answers, [current.id]: draft }
    setAnswers(collected)

    if (isVideo) {
      const pending = stillToAsk(collected)

      /*
        A question that is due NOW opens now, straight on top of this one, and
        the video is never returned to.

        This is the operator's bug of 2026-08-13. Two questions were set at the
        END of a video, and answering the first sent the player back to a film
        that had already finished — where `playVideo()` does not resume,
        it REWINDS. The advert restarted from zero and the second question was
        unreachable until the whole thing had played again. See nextDueQuestion
        for the rule; the short version is that a finished film has no clock
        left to raise anything with, so waiting on it waits forever.
      */
      const dueNow = nextDueQuestion(pending, { elapsed, filmOver: endedRef.current || filmOver })
      if (dueNow) {
        openQuestion(dueNow)
        return
      }

      if (pending.length > 0) {
        // A cue still ahead of the clock — that one genuinely is worth going
        // back to the video for.
        setCurrentId(null)
        setPhaseNow('playing')
        return
      }

      /*
        Every question the admin configured has been answered, so the ad is
        finished — the last cue is the end of the required watch, not the end
        of the video file. Waiting for the file to finish would strand a user
        on a ten-minute video whose questions were all in the first minute.

        The one exception is a minimum watch time that has not elapsed yet:
        then playback continues and the answers submit the moment it does,
        rather than being sent into a certain 'too_fast'.

        Unless the film is over, in which case there is no playback left to
        continue and going back would rewind it. An admin who gates an ad at
        more seconds than the film runs for has made it unwinnable either way;
        submitting is what turns that into a refusal the viewer can read
        instead of an advert that replays forever.
      */
      if (elapsed >= requiredWatch || endedRef.current || filmOver) {
        submit(collected)
      } else {
        pendingSubmitRef.current = collected
        setCurrentId(null)
        setPhaseNow('playing')
      }
      return
    }

    /*
      Survey: walk the visible list, recomputed WITH the answer just given —
      that answer is exactly what may have opened or closed a branch, so the
      next question has to be chosen from the new list, not the old one.
    */
    const nextVisible = visibleQuestions(questions, collected)
    const index = nextVisible.findIndex((q) => q.id === current.id)
    const next = nextVisible[index + 1]
    if (next) {
      setCurrentId(next.id)
      setDraft(answers[next.id] ?? '')
    } else {
      submit(collected)
    }
  }

  function goBack() {
    if (!current) return
    const index = visible.findIndex((q) => q.id === current.id)
    const previous = visible[index - 1]
    if (!previous) return
    setAnswers({ ...answers, [current.id]: draft })
    setCurrentId(previous.id)
    setDraft(answers[previous.id] ?? '')
  }

  /** Start the ad over. Nothing here is optional: the server cleared the
   *  watch stamp on the wrong answer, so every local trace of the last
   *  attempt has to go with it, and the fresh options arrive reshuffled. */
  function retry() {
    submittedRef.current = false
    askedRef.current = new Set()
    setAskedIds([])
    setAnswers({})
    setDraft('')
    setCurrentId(null)
    setResult(null)
    setCredited(false)
    setElapsed(0)
    endedRef.current = false
    setEnded(false)
    setReady(false)
    setPhaseNow('starting')
    setRunKey((k) => k + 1)
  }

  /**
   * Whether leaving now would throw something away.
   *
   * Closing does NOT spend an attempt — the attempt is recorded on submission
   * — but it does discard every answer given so far AND the server's watch
   * clock, which `register_ad_view` restarts from zero on the next open. So
   * the ad genuinely begins again, and somebody four questions into a survey
   * deserves to be told that before it happens.
   *
   * Nothing to lose means no dialog. A confirmation that fires when you have
   * done nothing is how people learn to dismiss confirmations without
   * reading them, and this one has to be read.
   */
  const answeredSoFar = Object.keys(answers).length
  const hasProgress =
    !credited &&
    phase !== 'starting' &&
    phase !== 'unavailable' &&
    phase !== 'submitting' &&
    /* Nor once the server has ruled. The answers are submitted, the attempt is
       spent, and there is nothing left to lose — asking "leave this ad?" over
       a result card is a confirmation about something that already happened. */
    phase !== 'result' &&
    (answeredSoFar > 0 || askedIds.length > 0 || elapsed > 0)

  const requestClose = useCallback(() => {
    if (!hasProgress) {
      onClose()
      return
    }
    setConfirmingClose(true)
  }, [hasProgress, onClose])

  // Escape asks the same question the X does, and the body must not scroll
  // behind a full-screen overlay.
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

  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0
  const answeredCount = askedIds.length
  /** Seconds of the admin's minimum watch still to run. */
  const watchLeft = Math.max(0, Math.ceil(requiredWatch - elapsed))
  /** Whether there is any film left worth staying for. A video whose duration
   *  is unknown counts as "yes" — the viewer decides, not a missing field. */
  const moreToWatch = duration === 0 || elapsed < duration - 1

  /*
    What answering the question on screen will actually do, computed the way
    answerCurrent computes it: with the answer being typed folded in, because
    that answer is exactly what may open or close a branch behind it. This
    only exists to label the button honestly — the decision itself is taken in
    answerCurrent, from the same two functions.
  */
  const pendingAfterCurrent = current
    ? visibleQuestions(questions, { ...answers, [current.id]: draft }).filter(
        (q) => !askedIds.includes(q.id),
      )
    : []
  const nextUpIsImmediate =
    nextDueQuestion(pendingAfterCurrent, { elapsed, filmOver }) !== null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ad.title}
      className={cn(
        'fixed inset-0 z-50 flex flex-col',
        isVideo ? 'bg-black' : 'bg-canvas',
      )}
    >
      {/* ---- Top bar ------------------------------------------------------ */}
      <header
        className={cn(
          /*
            THE STACK, IN ONE PLACE, because two of these have already cost a
            dead close button:
              10  question sheet
              20  the result card and its dim backdrop
              30  this header — the way out has to stay on top of both
              40  the "leave this ad?" dialog, which must cover everything
                  including the way out, since it IS the way out asking
            The X was at 20, tying with the result overlay — and a tie is
            decided by document order, so the backdrop that comes later won.
            Tapping the X while the result card was up did nothing at all, on
            every ad and every format; only Escape worked, which a phone does
            not have. Any new layer here belongs in this list.
          */
          'relative z-30 flex shrink-0 items-center gap-3 px-3 py-3 sm:px-5',
          isVideo ? 'text-white' : 'border-b border-ink-200 bg-surface text-ink-900',
        )}
      >
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('player.close')}
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
            isVideo ? 'bg-white/10 hover:bg-white/20' : 'hover:bg-ink-100',
          )}
        >
          <X aria-hidden className="size-5" />
        </button>

        {/* The brand, at the moment of most attention. The header already
            truncates both its lines, so the 32px this costs comes out of a
            title nobody reads in full on a phone anyway. */}
        <AdvertiserMark name={ad.advertiser} logoUrl={ad.advertiserLogoUrl} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-semibold">{ad.title}</p>
          <p
            className={cn(
              'truncate text-[0.75rem]',
              isVideo ? 'text-white/60' : 'text-ink-500',
            )}
          >
            {ad.advertiser ?? t('card.sponsored')}
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[0.75rem] font-bold tabular-nums',
            isVideo
              ? 'bg-white/12 text-white ring-1 ring-white/25'
              : 'border border-success-500/25 bg-success-50 text-success-700',
          )}
        >
          {t('card.reward', { points: ad.points })}
        </span>
      </header>

      {/* ---- Stage -------------------------------------------------------- */}
      {/* The question sheet slides up from the bottom on a phone, so while one
          is open the video moves to the top of the stage rather than staying
          centred with its lower half behind the sheet. From md up the sheet is
          a centred dialog and the video stays put. */}
      {/* Skipped entirely for a survey that is asking a question: a survey has
          no video, so the stage would be an empty band with the card floating
          below it. Handing the space to the card instead is what makes the
          screen look composed rather than half-loaded. */}
      {!(!isVideo && phase === 'question') && (
      <div
        className={cn(
          'relative flex min-h-0 flex-1 justify-center',
          phase === 'question' ? 'items-start md:items-center' : 'items-center',
        )}
      >
        {phase === 'starting' && (
          <div className={cn('flex flex-col items-center gap-3', isVideo && 'text-white/70')}>
            <Loader2 aria-hidden className="size-6 animate-spin" />
            <p className="text-[0.8125rem]">{t('player.loading')}</p>
          </div>
        )}

        {phase === 'unavailable' && (
          <div className="flex max-w-[26rem] flex-col items-center gap-4 px-6 text-center">
            <p className={cn('text-[0.9375rem] font-semibold', isVideo && 'text-white')}>
              {t('player.unavailableTitle')}
            </p>
            <p className={cn('text-[0.8125rem]', isVideo ? 'text-white/60' : 'text-ink-500')}>
              {t('player.unavailableBody')}
            </p>
            <Button onClick={onClose}>{t('result.done')}</Button>
          </div>
        )}

        {/* The video stays mounted while a question is up: unmounting it would
            drop the buffered stream and restart YouTube from scratch every
            time a cue fires. */}
        {isVideo && phase !== 'starting' && phase !== 'unavailable' && (
          <div className="relative aspect-video w-full max-w-[64rem] bg-black">
            <VideoStage
              ad={ad}
              /* Paused while the leave dialog is up. The SERVER's watch clock
                 keeps running regardless — it is wall time from
                 register_ad_view — so pausing here costs the user nothing and
                 cannot be used to stretch a watch requirement. */
              playing={phase === 'playing' && !confirmingClose}
              onTime={handleTime}
              onEnded={handleEnded}
              onReady={(d) => {
                setReady(true)
                setDuration((prev) => (d > 0 ? d : prev))
              }}
              // Nothing has been consumed at this point — the attempt is only
              // spent on submission — so the ad simply stays in the feed.
              onError={() => setPhaseNow('unavailable')}
            />

            {phase === 'intro' && (
              <button
                type="button"
                /* See `ready`: an early tap used to lose the gesture and the ad
                   never played. The spinner is the honest state — the ad is
                   loading — rather than a play icon that does nothing. */
                disabled={!ready}
                onClick={() => setPhaseNow('playing')}
                className="absolute inset-0 grid place-items-center bg-black/45 text-white disabled:cursor-default"
              >
                <span className="flex flex-col items-center gap-3">
                  <span className="grid size-20 place-items-center rounded-full bg-white/15 ring-1 ring-white/40 backdrop-blur-[2px]">
                    {ready ? (
                      <Play className="size-8 translate-x-[2px] fill-current" strokeWidth={0} />
                    ) : (
                      <Loader2 aria-hidden className="size-8 animate-spin" />
                    )}
                  </span>
                  <span className="text-[0.875rem] font-semibold">
                    {ready ? t('player.tapToPlay') : t('player.loading')}
                  </span>
                  {ready && questions.length > 0 && (
                    <span className="max-w-[24ch] text-center text-[0.75rem] text-white/70">
                      {t('player.questionsAhead', { count: questions.length })}
                    </span>
                  )}
                  {ready && questions.length === 0 && (
                    <span className="text-[0.75rem] text-white/70">
                      {t('player.watchOnlyHint')}
                    </span>
                  )}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Survey stage: no video, so the question owns the screen. */}
        {!isVideo && phase === 'intro' && (
          <div className="px-6 text-center text-[0.8125rem] text-ink-500">
            {t('player.loading')}
          </div>
        )}
      </div>
      )}

      {/* ---- Progress ----------------------------------------------------- */}
      {isVideo && (phase === 'playing' || phase === 'question') && (
        <div className="shrink-0 px-3 pb-4 sm:px-5">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/20">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-brand-500 transition-[width] duration-200 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
            {/* Cue markers, the way a video platform marks chapters. Seeing
                that a question is coming is fairer than being ambushed by it,
                and it does not weaken the check — the question is still
                unknown until it opens. */}
            {duration > 0 &&
              cued.map((q) => (
                <span
                  key={q.id}
                  aria-hidden
                  className={cn(
                    'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black/40',
                    askedIds.includes(q.id) ? 'bg-success-500' : 'bg-white',
                  )}
                  style={{
                    left: `${Math.min(((q.showAtSeconds ?? 0) / duration) * 100, 100)}%`,
                  }}
                />
              ))}
          </div>
          {/*
            THE WATCH REQUIREMENT, COUNTED DOWN.

            The admin can gate an ad at 20 seconds of a 60-second film, and
            until now the only way to discover that was to answer everything
            and be told "too fast". The number that decides whether this
            attempt pays is the one the viewer should be able to see, so it is
            on the screen, ticking, in the same place as the progress bar.

            Once it is satisfied it says so rather than disappearing — a
            counter that vanishes reads as a counter that broke.
          */}
          <div className="mt-2 flex items-center justify-between gap-3 text-xs sm:text-[0.8125rem] tabular-nums">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-semibold',
                credited
                  ? 'text-emerald-400'
                  : requiredWatch > 0
                    ? watchLeft > 0
                      ? 'text-white'
                      : 'text-emerald-400'
                    : 'text-white',
              )}
            >
              {credited ? (
                <>
                  <Check aria-hidden className="size-3.5 shrink-0 text-emerald-400" strokeWidth={2.5} />
                  <span>{t('player.watchFree')}</span>
                </>
              ) : requiredWatch > 0 ? (
                watchLeft > 0 ? (
                  <>
                    <Clock aria-hidden className="size-3.5 shrink-0 text-white/80" />
                    <span>{t('player.watchLeft', { seconds: watchLeft })}</span>
                  </>
                ) : (
                  <>
                    <Check aria-hidden className="size-3.5 shrink-0 text-emerald-400" strokeWidth={2.5} />
                    <span>{t('player.watchDone')}</span>
                  </>
                )
              ) : (
                ''
              )}
            </span>
            {questions.length > 0 && (
              <span className="font-medium text-white/85">
                {t('player.answeredCount', { done: answeredCount, total: questions.length })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ---- The advertiser's links --------------------------------------
          Video only, and never on a survey — the database refuses a call to
          action there, so `ctaLinks` is always empty for one. Kept out of the
          question sheet: a link that navigates away while a question is open
          would cost the viewer the answer they were typing. */}
      {isVideo && (phase === 'playing' || phase === 'intro') && (
        <div className="shrink-0 px-3 pb-4 sm:px-5">
          <AdCta label={ad.ctaLabel} links={ad.ctaLinks} tone="onVideo" />
          {/* Beside the links that leave the app, which is where it means
              something — the lawyer's requirement, 2026-07-31. */}
          <AdDisclosure tone="onDark" className="mt-2.5" />
        </div>
      )}

      {/* ---- Watching on after the credit --------------------------------
          The operator's objection was that answering the last question threw
          you out of the ad. It no longer does: the result card offers to keep
          watching, and this bar is how you leave when you are ready. */}
      {credited && phase === 'playing' && (
        <div className="shrink-0 border-t border-white/10 bg-black/60 px-3 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-emerald-400">
              <Check aria-hidden className="size-4" strokeWidth={2.5} />
              {t('player.creditedChip', { points: result?.pointsAwarded ?? ad.points })}
            </span>
            {nextAd && (
              <Button size="sm" onClick={() => onNextAd(nextAd)}>
                {nextAd.format === ad.format
                  ? t('result.nextAd')
                  : t(`result.nextFormat.${nextAd.format}`, { count: nextAdCount ?? 1 })}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onClose}>
              {t('result.done')}
            </Button>
          </div>
        </div>
      )}

      {/* ---- Question sheet ----------------------------------------------
          Bottom sheet on a phone (over the paused video, thumb-reachable) and
          a centred card from md up, which is the same split the rest of the
          app uses. */}
      {phase === 'question' && current && (
        <div
          className={cn(
            'z-10',
            // Phone: a sheet off the bottom, over the paused video, thumb
            // reachable. Identical for both formats.
            'absolute inset-x-0 bottom-0',
            isVideo
              ? /* Video, md+: a centred dialog over the still-visible frame.
                   pointer-events-none on the wrapper so the dead area around
                   the card cannot swallow a click meant for the chrome
                   underneath — which is how the close button got blocked. */
                'pointer-events-none md:inset-0 md:grid md:place-items-center md:bg-black/60 md:p-6'
              : /* Survey, md+: in the layout, not over it. It is the only
                   thing on the screen, so it takes the space the stage would
                   have used instead of hovering in the middle of a void. The
                   bottom bias sits it just above dead centre — on a portrait
                   tablet a small card centred in a 1,100px column reads as
                   having sunk to the bottom of the page. */
                'md:static md:grid md:min-h-0 md:flex-1 md:place-items-center md:p-6 md:pb-[8vh]',
          )}
        >
          <div
            className={cn(
              'pointer-events-auto w-full bg-surface p-5 shadow-[0_-8px_32px_-8px_rgb(15_23_42/0.3)]',
              'rounded-t-(--radius-panel) md:rounded-(--radius-panel)',
              'md:shadow-[0_16px_48px_-12px_rgb(15_23_42/0.45)]',
              // A survey card carries the whole screen, so it is allowed to be
              // wider than one floating over a video frame.
              isVideo ? 'md:max-w-[28rem]' : 'md:max-w-[32rem] md:p-6',
              // Clears the phone's home indicator.
              'pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:pb-5',
            )}
          >
            <QuestionSheet
              question={current}
              step={
                visible.length > 1 || branching
                  ? {
                      n: visible.findIndex((q) => q.id === current.id) + 1,
                      // A branching survey has no honest total: how many
                      // questions remain depends on answers not given yet.
                      // Better to count up than to promise a number that
                      // moves under the respondent.
                      total: branching ? undefined : visible.length,
                    }
                  : undefined
              }
              value={draft}
              onChange={setDraft}
              // Say it on the question itself, not just once at the start:
              // reassurance that arrives before you have seen the question is
              // reassurance nobody remembers.
              opinionOnly={ad.gradedCount === 0 && ad.questionCount > 0}
              onSubmit={answerCurrent}
              onBack={
                !isVideo && visible.findIndex((q) => q.id === current.id) > 0 ? goBack : undefined
              }
              submitLabel={
                isVideo
                  ? /*
                       Three things this button can do, and it has to say which.
                       "Next" when another question opens the instant this one
                       is answered, "Continue watching" when there is film or a
                       watch requirement still to run, "Finish" when it ends the
                       ad. Getting this wrong is how the operator's bug looked
                       from the outside: the button promised more video and
                       then delivered the advert from the top.

                       askedIds, not askedRef: the ref exists to beat the 4 Hz
                       tick, and refs must not be read during render.
                    */
                    nextUpIsImmediate
                    ? t('question.next')
                    : pendingAfterCurrent.length > 0 || elapsed < requiredWatch
                      ? t('question.resume')
                      : t('question.finish')
                  : visible.findIndex((q) => q.id === current.id) === visible.length - 1
                    ? t('question.finish')
                    : t('question.next')
              }
            />
          </div>
        </div>
      )}

      {/* ---- Leaving mid-attempt ------------------------------------------
          The X is the one control on this screen that throws work away, and
          it sits in the corner every "go back" instinct reaches for. So it
          asks — and it shows what would be lost, because "you will lose your
          progress" means nothing until you see that it is four answers and
          two minutes of watching.

          z-40 puts it above everything else on this screen — see the stack
          written out on the header. */}
      {confirmingClose && (
        <LeaveAdDialog
          body={isVideo ? t('leave.bodyVideo') : t('leave.bodySurvey')}
          note={t('leave.noAttempt')}
          onStay={() => setConfirmingClose(false)}
          onLeave={onClose}
          progress={
            <>
              {isVideo && (
                <>
                  <LeaveFact className="mt-1.5">
                    {t('leave.watched', { seconds: Math.floor(elapsed) })}
                  </LeaveFact>
                  {duration > 0 && <LeaveBar fraction={progress} />}
                </>
              )}

              {questions.length > 0 && (
                <LeaveFact className={isVideo ? 'mt-2' : 'mt-1.5'}>
                  {branching
                    ? t('leave.answered', { done: answeredSoFar })
                    : t('leave.answeredOf', { done: answeredSoFar, total: visible.length })}
                </LeaveFact>
              )}
            </>
          }
        />
      )}

      {/* ---- Submitting / result ------------------------------------------ */}
      {(phase === 'submitting' || phase === 'result') && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 p-4 md:p-6">
          <div className="w-full max-w-[26rem] rounded-(--radius-panel) bg-surface shadow-[0_16px_48px_-12px_rgb(15_23_42/0.5)]">
            {phase === 'submitting' ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-ink-500">
                <Loader2 aria-hidden className="size-6 animate-spin text-brand-600" />
                <p className="text-[0.8125rem]">{t('result.checking')}</p>
              </div>
            ) : (
              result && (
                <AdResult
                  result={result}
                  format={ad.format}
                  ad={ad}
                  nextAd={nextAd}
                  nextAdCount={nextAdCount}
                  onNext={onClose}
                  onRetry={retry}
                  /* Only offered when there is genuinely more film: a card
                     that promises "keep watching" on a finished video is a
                     button that does nothing. */
                  onKeepWatching={
                    credited && isVideo && moreToWatch ? () => setPhaseNow('playing') : undefined
                  }
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
