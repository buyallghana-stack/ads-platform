'use client'

import { useEffect, useRef, useState } from 'react'

import {
  BookOpen,
  Lock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { BuyButton } from '@/components/affiliate/BuyButton'
import { LessonQuiz } from '@/components/affiliate/LessonQuiz'
import { Link, useRouter } from '@/i18n/navigation'
import type { LessonPayload, Neighbour } from '@/lib/market/course'
import { cedis } from '@/lib/market/money'
import { markLessonProgress } from '@/app/[locale]/(affiliate)/learn/[slug]/actions'
import { cn } from '@/lib/cn'

/**
 * One lesson: a video, an article, or a PDF, plus its checkpoint quizzes.
 *
 * ── PROGRESS IS RECORDED BY WATCHING, NOT BY CLICKING "DONE" ──
 *
 * For a video the player reports position and the server decides whether that
 * counts. A "mark complete" button would make the activation threshold — the
 * thing that switches on the ability to earn real money — a formality anybody
 * can click through in ten seconds. The reading time IS the defence, exactly as
 * it is for link ads.
 *
 * Articles are the exception and they need one, because there is no playhead to
 * read: they complete on reaching the bottom AND on a dwell floor, so scrolling
 * to the end instantly does not count.
 *
 * ── THE SERVER DECIDES, ALWAYS ──
 *
 * Everything here reports; nothing here concludes. `record_lesson_progress`
 * applies `lesson_pass_percent`, refuses progress on a lesson the caller has
 * not bought, and is the only thing that can move the number the affiliate
 * account is gated on. A browser is not a witness.
 */

/* ⚠️ 15, HARD CODED, AND THE NUMBER IS SHOWN TO THE READER (operator,
   2026-08-07: "indicate with a pop up the amount of seconds they need to read
   for which is 15 seconds hard coded"). It was 20 and it was invisible, which
   is the combination that made a rule look like a broken button. */
const DWELL_SECONDS = 15

export function LessonView({
  payload,
  slug,
  previous,
  next,
  poster,
  offer,
}: {
  payload: LessonPayload
  slug: string
  previous: Neighbour
  next: Neighbour
  /** The course cover, so the player is not a black rectangle before play. */
  poster: string | null
  /** What buying this course costs and gets you. Null when it is already
   *  owned, which is when the locked state can never be reached. */
  offer: LessonOffer | null
}) {
  const t = useTranslations('affiliate.course')

  /*
    ⚠️ WHY "NEXT" DID NOT MARK AN ARTICLE READ (operator, 2026-08-07).

    An article completes on two conditions: the end of the text in view AND
    `DWELL_SECONDS` spent on it. Neither is a click, so tapping Next did
    nothing at all — no mark, and no explanation either, which is what made it
    look broken rather than strict.

    The reading time is the real defence and it stays. What changes is that the
    SCROLL half is no longer the only way to satisfy the first condition:
    somebody who has genuinely sat with a long article for twenty seconds and
    then moves on has done the thing the rule is protecting. So Next now marks
    it, if and only if the dwell has elapsed.

    Clicking Next in the first few seconds still marks nothing — and now says
    so, because the article carries a visible line about what it is waiting
    for. A silent refusal is what turned a rule into a bug report.
  */
  const articleReady = useRef(false)
  /* Seconds still owed on an article, or null when it is not an article or the
     time is served. Held in STATE, not a ref, because the popup prints it. */
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const markArticle = () => {
    if (!payload.ok || payload.lesson.kind === 'video') return
    if (!articleReady.current || payload.progress.completed) return
    void markLessonProgress(payload.lesson.id, slug, DWELL_SECONDS, 100)
  }

  if (!payload.ok) {
    /*
      ⚠️ A LOCKED LESSON IS THE BEST SELLING MOMENT THE COURSE HAS, and it used
      to spend it on the sentence "You do not own this lesson." Somebody who
      has just watched the free preview and tapped the next lesson has already
      decided they are interested; telling them what they cannot do and
      stopping is the one response that wastes that.

      So it is an offer, with the price and the Paystack button on it. The
      button is the same `BuyButton` the product page uses — one checkout
      path, and the price is read server-side by `startCheckout` so nothing
      here can name its own.
    */
    if (payload.reason === 'locked' && offer) {
      return <LockedOffer offer={offer} />
    }

    return (
      <div className="rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-10 text-center">
        <p className="text-[0.875rem] font-medium text-ink-900">
          {t(payload.reason === 'locked' ? 'lockedTitle' : 'missingTitle')}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
          {t(payload.reason === 'locked' ? 'lockedBody' : 'missingBody')}
        </p>
      </div>
    )
  }

  const { lesson, progress } = payload
  const video = lesson.kind === 'video'

  /*
    THE TITLE GOES WHERE THE CONTENT PUTS IT.

    Under a video, per the reference: the player is the thing you came for and
    it should be the first thing under the thumb, with the title as a caption.

    ABOVE an article, because an article has no player — the title IS its
    heading, and a heading printed after the text it names reads as a footnote.
    The reference only ever shows the video case, so following it literally
    would have made every written lesson start mid-sentence.
  */
  const heading = (
    <div className={video ? 'border-t border-ink-200 px-4 py-3.5' : 'border-b border-ink-200 px-4 py-3.5'}>
      <p className="text-[0.75rem] text-ink-500">{lesson.section_title}</p>
      {/* `items-start` and a wrapped, `min-w-0` title.

          Raw text directly inside a flex container becomes an ANONYMOUS flex
          item, and like every flex item it defaults to `min-width: auto` — so
          a long lesson title did not wrap, it pushed the page 140px wider than
          a 390px phone. Wrapping it in a span that is allowed to shrink is the
          fix; `items-start` keeps the tick aligned to the first line once the
          title runs to two. */}
      <h1 className="mt-0.5 flex items-start gap-2 text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
        {progress.completed && (
          <CheckCircle2 aria-hidden className="mt-0.5 size-4.5 shrink-0 text-success-600" />
        )}
        <span className="min-w-0">{lesson.title}</span>
      </h1>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
        {!video && heading}

        {video ? (
          <VideoLesson
            lessonId={lesson.id}
            slug={slug}
            seconds={progress.seconds_watched}
            poster={poster}
            previous={previous}
            next={next}
          />
        ) : lesson.kind === 'quiz' ? (
          /* A checkpoint lesson has no body of its own — the quizzes below ARE
             the lesson. Rendering it through ArticleLesson (which is what a
             kind-based else branch does) drew an empty page with an invisible
             read-tracker on it. */
          <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-ink-600">
            {t('checkpointIntro')}
          </p>
        ) : (
          <ArticleLesson
            lessonId={lesson.id}
            slug={slug}
            body={lesson.body}
            done={progress.completed}
            onDwellMet={() => {
              articleReady.current = true
              setSecondsLeft(null)
            }}
            onCountdown={setSecondsLeft}
          />
        )}

        {video && heading}
      </div>

      {payload.quizzes.map((quiz) => (
        <LessonQuiz key={quiz.id} quiz={quiz} slug={slug} />
      ))}

      {payload.resources.length > 0 && (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4">
          <p className="text-[0.8125rem] font-semibold text-ink-900">{t('resources')}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {payload.resources.map((resource) => (
              <li
                key={resource.id}
                className="flex items-center gap-2.5 text-[0.8125rem] text-ink-700"
              >
                <FileText aria-hidden className="size-4 shrink-0 text-ink-400" />
                {resource.title}
              </li>
            ))}
          </ul>
          {/* Read in app, never handed over — a downloadable copy of a paid
              course is a copy that outlives the entitlement. */}
          <p className="mt-2 text-[0.75rem] text-ink-500">{t('resourcesNote')}</p>
        </div>
      )}

      <LessonNav
        slug={slug}
        previous={previous}
        next={next}
        onLeave={markArticle}
        /* ⚠️ A CHECKPOINT IS NOW A GATE. It used to be a card under the video
           that Next walked straight past — `at_seconds` was stored and never
           read, so "checkpoint" meant "optional quiz". Since the certificate
           depends on the average score, a course anybody can click through is
           a certificate anybody can collect. */
        blocked={
          !payload.checkpointsPassed
            ? 'checkpoint'
            : secondsLeft !== null && secondsLeft > 0
              ? { secondsLeft }
              : null
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Previous and Next, under every lesson whatever kind it is.
 *
 * ── IT IS NOT ONLY FOR VIDEOS ──
 *
 * A video announces its own ending and can offer the next lesson over the last
 * frame. An article and a checkpoint end without saying so, and the operator's
 * point (2026-08-07) is that finishing one of those and then having to hunt the
 * list for what comes next is the moment a course gets abandoned. Same control,
 * same place, all three kinds.
 *
 * ── BOTH ARROWS ARE ALWAYS LIVE ──
 *
 * Skipping ahead is allowed, because skipping earns nothing: completion is
 * recorded by watching or reading, and the activation threshold is what gates
 * the ability to earn. Locking Next until a lesson is finished would only
 * trap somebody who cannot pass a checkpoint, and it would gate them on the
 * one screen they cannot get past.
 */
function LessonNav({
  slug,
  previous,
  next,
  onLeave,
  blocked,
}: {
  slug: string
  previous: Neighbour
  next: Neighbour
  /** Fires before the navigation, so an article that has met its reading time
   *  is recorded on the way out rather than lost. */
  onLeave: () => void
  /** Why Next cannot be used yet, or null. PREVIOUS is never blocked: going
   *  back to re-read is the thing somebody stuck on a checkpoint should do. */
  blocked: 'checkpoint' | { secondsLeft: number } | null
}) {
  const t = useTranslations('affiliate.course')
  const [nudge, setNudge] = useState(false)
  if (!previous && !next) return null

  const shell =
    'flex min-w-0 flex-1 items-center gap-2 rounded-(--radius-card) border px-3.5 py-3 transition-colors'

  return (
    <nav aria-label={t('navLabel')} className="flex items-stretch gap-2">
      {previous ? (
        <Link
          href={{ pathname: `/learn/${slug}`, query: { lesson: previous.id } }}
          onClick={onLeave}
          className={cn(shell, 'border-ink-200 bg-surface hover:bg-ink-50')}
        >
          <ChevronLeft aria-hidden className="size-4 shrink-0 text-ink-400" />
          <span className="min-w-0">
            <span className="block text-[0.6875rem] uppercase tracking-wide text-ink-500">
              {t('previous')}
            </span>
            <span className="block truncate text-[0.8125rem] font-medium text-ink-800">
              {previous.title}
            </span>
          </span>
        </Link>
      ) : (
        /* Holds the column so a first lesson does not throw Next to the left. */
        <span aria-hidden className="min-w-0 flex-1" />
      )}

      {next &&
        (blocked ? (
          /* A BUTTON, not a disabled link. A greyed control says "no" and
             stops; this one says why, which is the whole difference between
             a rule and a bug report. */
          <button
            type="button"
            onClick={() => setNudge(true)}
            className={cn(shell, 'justify-end border-ink-200 bg-ink-50 text-left')}
          >
            <span className="min-w-0 text-right">
              <span className="block text-[0.6875rem] uppercase tracking-wide text-ink-400">
                {t('next')}
              </span>
              <span className="block truncate text-[0.8125rem] font-medium text-ink-500">
                {next.title}
              </span>
            </span>
            <Lock aria-hidden className="size-4 shrink-0 text-ink-400" />
          </button>
        ) : (
          <Link
            href={{ pathname: `/learn/${slug}`, query: { lesson: next.id } }}
            onClick={onLeave}
            className={cn(shell, 'justify-end border-brand-600 bg-brand-600 hover:bg-brand-700')}
          >
            <span className="min-w-0 text-right">
              <span className="block text-[0.6875rem] uppercase tracking-wide text-white/70">
                {t('next')}
              </span>
              <span className="block truncate text-[0.8125rem] font-medium text-white">
                {next.title}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-white/80" />
          </Link>
        ))}

      {nudge && blocked && (
        <NextBlocked reason={blocked} onClose={() => setNudge(false)} />
      )}
    </nav>
  )
}

/* ------------------------------------------------------------------ */

function VideoLesson({
  lessonId,
  slug,
  seconds,
  poster,
  previous,
  next,
}: {
  lessonId: string
  slug: string
  seconds: number
  poster: string | null
  previous: Neighbour
  next: Neighbour
}) {
  const t = useTranslations('affiliate.course')
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [ended, setEnded] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  const lastSent = useRef(0)

  /* The signed URL is fetched rather than embedded in the page, because it
     expires in minutes and a server-rendered page can sit in a tab for hours. */
  useEffect(() => {
    let live = true
    fetch(`/api/lesson-media/${lessonId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('refused'))))
      .then((body: { url: string }) => live && setUrl(body.url))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [lessonId])

  /* Reported every ten seconds, not on every tick: the server is the judge and
     it does not need 25 samples a second to be one. */
  const onTime = () => {
    const el = video.current
    if (!el) return
    const at = Math.floor(el.currentTime)
    if (at - lastSent.current < 10) return
    lastSent.current = at
    const percent = el.duration ? Math.floor((at / el.duration) * 100) : 0
    void markLessonProgress(lessonId, slug, at, percent)
  }

  if (failed) {
    return (
      <p className="px-5 py-10 text-center text-[0.8125rem] text-ink-500">{t('videoFailed')}</p>
    )
  }

  const rewatch = () => {
    const el = video.current
    if (!el) return
    el.currentTime = 0
    setEnded(false)
    void el.play()
  }

  return (
    <div className="relative aspect-video w-full bg-black">
      {url ? (
        <video
          ref={video}
          src={url}
          poster={poster ?? undefined}
          controls
          playsInline
          className="size-full"
          onLoadedMetadata={(e) => {
            /* Resume where they stopped. Not past the end — a lesson finished
               last week would otherwise open on its final frame. */
            const el = e.currentTarget
            if (seconds > 5 && seconds < el.duration - 5) el.currentTime = seconds
          }}
          onTimeUpdate={onTime}
          onPlay={() => setEnded(false)}
          onEnded={() => {
            setEnded(true)
            void markLessonProgress(lessonId, slug, Math.floor(video.current?.duration ?? 0), 100)
          }}
        />
      ) : (
        <div className="grid size-full place-items-center text-white/60">
          <Loader2 aria-hidden className="size-6 animate-spin" />
        </div>
      )}

      {/*
        THE END PANEL, over the last frame.

        The operator asked for it there rather than under the player, and that
        is right: the moment a video stops is the moment the decision gets
        made, and the eye is already on the picture. Under the player it would
        be below the fold on a phone held in one hand.

        It covers the video but NOT the control bar, so the scrubber stays
        reachable — somebody who wants to go back to 4:12 rather than restart
        should not have to dismiss anything first.
      */}
      {ended && (
        <div className="absolute inset-x-0 top-0 bottom-12 grid place-items-center bg-black/72 px-4 backdrop-blur-[2px]">
          <div className="flex w-full max-w-xs flex-col items-center gap-3">
            <button
              type="button"
              onClick={rewatch}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-[0.8125rem] font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw aria-hidden className="size-4" />
              {t('rewatch')}
            </button>

            <div className="flex w-full items-center justify-center gap-2">
              {previous && (
                <button
                  type="button"
                  onClick={() =>
                    router.push({
                      pathname: `/learn/${slug}`,
                      query: { lesson: previous.id },
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] font-medium text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                  {t('previous')}
                </button>
              )}

              {next && (
                <button
                  type="button"
                  onClick={() =>
                    router.push({ pathname: `/learn/${slug}`, query: { lesson: next.id } })
                  }
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {t('next')}
                  <ChevronRight aria-hidden className="size-4" />
                </button>
              )}
            </div>

            {next && <p className="truncate text-[0.75rem] text-white/60">{next.title}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function ArticleLesson({
  lessonId,
  slug,
  body,
  done,
  onDwellMet,
  onCountdown,
}: {
  lessonId: string
  slug: string
  body: string | null
  done: boolean
  /** Told the moment the reading time is satisfied, so Next can record it. */
  onDwellMet: () => void
  /** Seconds still owed, ticked down so the popup can name a real number
   *  rather than repeating the full fifteen every time. */
  onCountdown: (seconds: number) => void
}) {
  const t = useTranslations('affiliate.course')
  const [reached, setReached] = useState(false)
  const end = useRef<HTMLDivElement | null>(null)
  /* The pane the text scrolls inside. It is also the observer's ROOT: the
     sentinel is no longer in the page's scroll, so watching the viewport would
     mean watching a box that never moves. */
  const pane = useRef<HTMLDivElement | null>(null)
  /* Stamped in the effect, not during render. `useRef(Date.now())` evaluates
     the clock on every render even though only the first value is kept — which
     is both impure and, on a re-render, a different number being thrown away. */
  const opened = useRef(0)

  /*
    Two conditions, both required: the bottom has to come into view AND the
    reader has to have been here for `DWELL_SECONDS`. Either one alone is
    trivially defeated — a fast scroll satisfies the first, an idle tab
    satisfies the second — and this lesson type has no playhead to fall back on.

    ⚠️ THE DWELL NEEDS A TIMER, NOT JUST AN EARLY RETURN, AND THIS WAS A REAL
    BUG. IntersectionObserver only fires when the intersection CHANGES. Reach
    the bottom of a short article at eight seconds and the callback ran, failed
    the twenty-second check, returned — and then never fired again, because the
    sentinel simply stayed in view. The lesson was never marked read no matter
    how long they sat there, which is what the operator saw as "sometimes even
    after clicking next it fails to mark articles as read".

    So arriving at the bottom early SCHEDULES the mark instead of discarding
    it, and scrolling away cancels it. The defence is unchanged: twenty seconds
    with the end of the article in front of you.
  */
  useEffect(() => {
    if (done || !end.current) return
    opened.current = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined

    /* The dwell alone, reported upward the moment it is met and regardless of
       where they have scrolled to. It does not complete the lesson by itself —
       that still needs the end of the text — but it is what tells Next it may
       record on the way out. */
    const dwellTimer = setTimeout(() => onDwellMet(), DWELL_SECONDS * 1000)

    /* Ticked once a second so the popup can say "8 seconds", not "15". */
    onCountdown(DWELL_SECONDS)
    const tick = setInterval(() => {
      const left = Math.ceil(DWELL_SECONDS - (Date.now() - opened.current) / 1000)
      onCountdown(Math.max(left, 0))
      if (left <= 0) clearInterval(tick)
    }, 1000)

    const mark = () => {
      setReached(true)
      void markLessonProgress(lessonId, slug, DWELL_SECONDS, 100)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(timer)
        if (!entry?.isIntersecting) return
        const waited = (Date.now() - opened.current) / 1000
        if (waited >= DWELL_SECONDS) {
          mark()
          observer.disconnect()
          return
        }
        timer = setTimeout(() => {
          mark()
          observer.disconnect()
        }, (DWELL_SECONDS - waited) * 1000)
      },
      { root: pane.current, rootMargin: '0px 0px -5% 0px' },
    )
    observer.observe(end.current)
    return () => {
      clearTimeout(timer)
      clearTimeout(dwellTimer)
      clearInterval(tick)
      observer.disconnect()
    }
  }, [done, lessonId, slug, onDwellMet, onCountdown])

  return (
    <div>
      {/*
        THE ARTICLE SCROLLS INSIDE ITS OWN PANE (operator, 2026-08-07).

        A four-hundred-word lesson printed straight into the page made the page
        four screens tall, which pushed the curriculum, the checkpoint and Next
        so far down that the rest of the screen drifted out of reach. Bounding
        the text keeps every control a predictable distance from the top.

        ⚠️ TWO CORRECTIONS AFTER THE FIRST ATTEMPT, both from the operator
        using it: "it fills the screen too much making scrolling down hard, it
        scrolls the text down and there is a little space for you to scroll
        down."

        1. 26rem was 416px of a 844px phone, so almost every downward drag
           landed inside the pane and moved the TEXT. There was no room left to
           drag the page. 19rem leaves the page reachable above and below it.

        2. `overscroll-contain` was wrong here. It was meant to stop the page
           lurching when the article ends, but what it actually does is trap
           the gesture: reach the bottom of the text and scrolling simply
           stops, instead of carrying on down the page the way every reader
           expects. Chaining is the default and the default was right.
      */}
      <div
        ref={pane}
        tabIndex={0}
        className="max-h-[19rem] overflow-y-auto px-4 py-5 focus-visible:outline-none sm:px-6 md:max-h-[26rem]"
      >
        <div
          className={cn(
            'prose-sp max-w-none text-[0.9375rem] leading-relaxed text-ink-800',
            '[&_h2]:mt-6 [&_h2]:text-[1.0625rem] [&_h2]:font-semibold [&_h2]:text-ink-900',
            '[&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-ink-900',
            '[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1.5',
            '[&_strong]:font-semibold [&_strong]:text-ink-900',
          )}
        >
          {(body ?? '').split('\n\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        <div ref={end} className="h-px" />
      </div>

      {/* ⚠️ ALWAYS SAYS SOMETHING. Before this line existed, an article that
          had not met its reading time simply did nothing when Next was tapped,
          and a rule with no visible state is indistinguishable from a bug —
          which is exactly how it was reported. */}
      <p
        className={cn(
          'flex items-center gap-2 border-t border-ink-200 px-4 py-3 text-[0.8125rem] sm:px-6',
          done || reached ? 'font-medium text-success-600' : 'text-ink-500',
        )}
      >
        {done || reached ? (
          <>
            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            {t('articleDone')}
          </>
        ) : (
          <>
            <BookOpen aria-hidden className="size-4 shrink-0 text-ink-400" />
            {t('articleReading')}
          </>
        )}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Why Next did nothing.
 *
 * ── A DIALOG RATHER THAN A DISABLED BUTTON ──
 *
 * The operator asked for a pop-up, and the reason it is the right answer is
 * that the two blocked states have different answers. A checkpoint is a thing
 * to go and do; a reading timer is a thing to wait out, and the only useful
 * response is the number of seconds left. A greyed button says neither.
 *
 * It closes on the backdrop, on Escape and on its own button, because a modal
 * with one way out is a modal somebody gets stuck in on a phone.
 */
function NextBlocked({
  reason,
  onClose,
}: {
  reason: 'checkpoint' | { secondsLeft: number }
  onClose: () => void
}) {
  const t = useTranslations('affiliate.course.blocked')
  const checkpoint = reason === 'checkpoint'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="animate-rise w-full max-w-sm rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center"
      >
        <span
          aria-hidden
          className={cn(
            'mx-auto grid size-12 place-items-center rounded-full',
            checkpoint ? 'bg-warning-500/15 text-warning-600' : 'bg-brand-600/12 text-brand-700',
          )}
        >
          {checkpoint ? <Lock className="size-5" /> : <BookOpen className="size-5" />}
        </span>

        <h2 className="mt-3 text-[1rem] font-semibold text-ink-900">
          {checkpoint ? t('checkpointTitle') : t('readingTitle', { n: reason.secondsLeft })}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[30ch] text-[0.8125rem] leading-snug text-ink-500">
          {checkpoint ? t('checkpointBody') : t('readingBody')}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          {t('gotIt')}
        </button>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */

export type LessonOffer = {
  productId: string
  title: string
  priceMinor: number
  listPriceMinor: number
  onSale: boolean
  lessons: number
  certificate: boolean
}

/**
 * The rest of the course, offered on the lesson they could not open.
 *
 * ── WHAT IT SAYS, AND WHY IN THAT ORDER ──
 *
 * The preview is what they just watched, so the offer leads with how much
 * MORE there is rather than repeating what the course is. Then the price,
 * then one tap to Paystack. Anything else on this card is between somebody
 * who has decided and the thing they decided to do.
 *
 * The sale price is shown struck through against the full one only when
 * `onSale` is true — a fake original price beside a real one is the oldest
 * trick in retail and it is not one this platform plays.
 */
function LockedOffer({ offer }: { offer: LessonOffer }) {
  const t = useTranslations('affiliate.course.offer')

  return (
    <section className="overflow-hidden rounded-(--radius-panel) border border-brand-600/30 bg-brand-600/8">
      <div className="px-5 py-6 text-center sm:px-6">
        <span
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full bg-brand-600/12 text-brand-700"
        >
          <Lock className="size-5" />
        </span>

        <h2 className="mt-3 text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-ink-600">
          {t('body', { title: offer.title, lessons: offer.lessons })}
        </p>

        <ul className="mx-auto mt-4 flex max-w-xs flex-col gap-1.5 text-left">
          {[
            t('perkLessons', { n: offer.lessons }),
            offer.certificate ? t('perkCertificate') : null,
            t('perkEarn'),
          ]
            .filter((x) => x !== null)
            .map((x) => (
              <li key={x} className="flex items-start gap-2 text-[0.8125rem] text-ink-700">
                <CheckCircle2
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-brand-700"
                  strokeWidth={2.5}
                />
                {x}
              </li>
            ))}
        </ul>

        <p className="mt-4 flex items-baseline justify-center gap-2">
          <span className="text-[1.5rem] font-bold tracking-[-0.02em] text-ink-900">
            {cedis(offer.priceMinor)}
          </span>
          {offer.onSale && offer.listPriceMinor > offer.priceMinor && (
            <span className="text-[0.9375rem] text-ink-400 line-through">
              {cedis(offer.listPriceMinor)}
            </span>
          )}
        </p>

        {/* Straight to Paystack. Same component and same server action as the
            product page, so there is one checkout to keep working. */}
        <BuyButton
          productId={offer.productId}
          label={t('cta')}
          className="mx-auto mt-4 max-w-xs"
        />
      </div>
    </section>
  )
}
