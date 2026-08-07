'use client'

import { useEffect, useRef, useState } from 'react'

import { ChevronLeft, ChevronRight, CheckCircle2, FileText, Loader2, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { LessonQuiz } from '@/components/affiliate/LessonQuiz'
import { Link, useRouter } from '@/i18n/navigation'
import type { LessonPayload, Neighbour } from '@/lib/market/course'
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

const DWELL_SECONDS = 20

export function LessonView({
  payload,
  slug,
  previous,
  next,
  poster,
}: {
  payload: LessonPayload
  slug: string
  previous: Neighbour
  next: Neighbour
  /** The course cover, so the player is not a black rectangle before play. */
  poster: string | null
}) {
  const t = useTranslations('affiliate.course')

  if (!payload.ok) {
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
          <ArticleLesson lessonId={lesson.id} slug={slug} body={lesson.body} done={progress.completed} />
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

      <LessonNav slug={slug} previous={previous} next={next} />
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
}: {
  slug: string
  previous: Neighbour
  next: Neighbour
}) {
  const t = useTranslations('affiliate.course')
  if (!previous && !next) return null

  const shell =
    'flex min-w-0 flex-1 items-center gap-2 rounded-(--radius-card) border px-3.5 py-3 transition-colors'

  return (
    <nav aria-label={t('navLabel')} className="flex items-stretch gap-2">
      {previous ? (
        <Link
          href={{ pathname: `/learn/${slug}`, query: { lesson: previous.id } }}
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

      {next && (
        <Link
          href={{ pathname: `/learn/${slug}`, query: { lesson: next.id } }}
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
}: {
  lessonId: string
  slug: string
  body: string | null
  done: boolean
}) {
  const t = useTranslations('affiliate.course')
  const [reached, setReached] = useState(false)
  const end = useRef<HTMLDivElement | null>(null)
  /* Stamped in the effect, not during render. `useRef(Date.now())` evaluates
     the clock on every render even though only the first value is kept — which
     is both impure and, on a re-render, a different number being thrown away. */
  const opened = useRef(0)

  /*
    Two conditions, both required: the bottom has to come into view AND the
    reader has to have been here for `DWELL_SECONDS`. Either one alone is
    trivially defeated — a fast scroll satisfies the first, an idle tab
    satisfies the second — and this lesson type has no playhead to fall back on.
  */
  useEffect(() => {
    if (done || !end.current) return
    opened.current = Date.now()
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        if ((Date.now() - opened.current) / 1000 < DWELL_SECONDS) return
        setReached(true)
        void markLessonProgress(lessonId, slug, DWELL_SECONDS, 100)
        observer.disconnect()
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(end.current)
    return () => observer.disconnect()
  }, [done, lessonId, slug])

  return (
    <div className="px-4 py-5 sm:px-6">
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

      {(done || reached) && (
        <p className="mt-5 flex items-center gap-2 text-[0.8125rem] font-medium text-success-600">
          <CheckCircle2 aria-hidden className="size-4" />
          {t('articleDone')}
        </p>
      )}
    </div>
  )
}
