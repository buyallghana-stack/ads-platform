'use client'

import { useEffect, useRef, useState } from 'react'

import { CheckCircle2, FileText, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { LessonPayload } from '@/lib/market/course'
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

export function LessonView({ payload, slug }: { payload: LessonPayload; slug: string }) {
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
      <h1 className="mt-0.5 flex items-center gap-2 text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
        {progress.completed && (
          <CheckCircle2 aria-hidden className="size-4.5 shrink-0 text-success-600" />
        )}
        {lesson.title}
      </h1>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface">
        {!video && heading}

        {video ? (
          <VideoLesson lessonId={lesson.id} slug={slug} seconds={progress.seconds_watched} />
        ) : (
          <ArticleLesson lessonId={lesson.id} slug={slug} body={lesson.body} done={progress.completed} />
        )}

        {video && heading}
      </div>

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
    </div>
  )
}

/* ------------------------------------------------------------------ */

function VideoLesson({
  lessonId,
  slug,
  seconds,
}: {
  lessonId: string
  slug: string
  seconds: number
}) {
  const t = useTranslations('affiliate.course')
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
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

  return (
    <div className="aspect-video w-full bg-black">
      {url ? (
        <video
          ref={video}
          src={url}
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
          onEnded={() => void markLessonProgress(lessonId, slug, Math.floor(video.current?.duration ?? 0), 100)}
        />
      ) : (
        <div className="grid size-full place-items-center text-white/60">
          <Loader2 aria-hidden className="size-6 animate-spin" />
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
