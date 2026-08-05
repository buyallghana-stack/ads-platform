'use client'

import { useCallback, useState } from 'react'
import { Check, Paperclip, VideoOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { CurriculumList } from '@/components/market/CurriculumList'
import { LessonPlayer } from '@/components/market/LessonPlayer'
import { LessonQuiz } from '@/components/market/LessonQuiz'
import { cn } from '@/lib/cn'
import type { Quiz, Section } from '@/lib/market/course'
import {
  markReadAction,
  recordProgressAction,
  submitQuizAction,
} from '@/app/[locale]/(app)/learn/actions'

/**
 * A lesson, whichever of the four kinds it is.
 *
 * ---------------------------------------------------------------------------
 * TWO LAYOUTS, NOT ONE SCALED
 *
 * Sticky-player-over-a-scrolling-list is a PHONE answer to a phone problem:
 * one column, so the video has to stay put while you look for the next lesson.
 * On a desktop that problem does not exist — there is room for both at once —
 * and stacking them there would waste the width and hide the structure.
 *
 * So at `lg` the curriculum becomes a rail beside the content rather than
 * beneath it. Right-hand side, matching the operator's reference: the video is
 * what you came for, so it takes the natural left-to-right starting position.
 */
export function LessonView({
  lesson,
  sections,
  quizzes,
  progress,
  resources,
  mediaUrl,
  slug,
  entitled,
  courseTitle,
}: {
  lesson: {
    id: string
    title: string
    kind: 'video' | 'article' | 'pdf' | 'quiz'
    section_title: string
    duration_seconds: number | null
    is_preview: boolean
    body: string | null
  }
  sections: Section[]
  quizzes: Quiz[]
  progress: { seconds_watched: number; watched_percent: number; completed: boolean }
  resources: { id: string; title: string; byte_size: number | null }[]
  mediaUrl: string | null
  slug: string
  entitled: boolean
  courseTitle: string
}) {
  const t = useTranslations('market.course')
  const router = useRouter()
  const [done, setDone] = useState(progress.completed)

  const checkpoints = quizzes.filter((q) => q.at_seconds !== null)
  const standalone = quizzes.find((q) => q.at_seconds === null)

  const onProgress = useCallback(
    (seconds: number, percent: number) => {
      void recordProgressAction(lesson.id, seconds, percent)
    },
    [lesson.id],
  )

  const onSubmitQuiz = useCallback(async (quizId: string, answers: Record<string, string>) => {
    const result = await submitQuizAction(quizId, answers)
    /* A failed round trip is reported as a failed attempt rather than thrown.
       A network error mid-checkpoint should leave somebody looking at "try
       again", not at a crashed page with their place in the video lost. */
    return result.ok ? { score: result.score, passed: result.passed } : { score: 0, passed: false }
  }, [])

  const markRead = useCallback(async () => {
    const result = await markReadAction(lesson.id)
    if (result.ok) {
      setDone(true)
      router.refresh()
    }
  }, [lesson.id, router])

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        {lesson.kind === 'video' &&
          (mediaUrl ? (
            <LessonPlayer
              src={mediaUrl}
              quizzes={checkpoints}
              startAt={progress.seconds_watched}
              isPreview={lesson.is_preview}
              onProgress={onProgress}
              onSubmitQuiz={onSubmitQuiz}
              onAllPassed={() => {
                setDone(true)
                router.refresh()
              }}
            />
          ) : (
            /* The signed URL could not be issued — the file is missing, or
               storage refused. Without this the lesson simply renders with no
               video and no explanation, which reads as a broken page and
               produces a support ticket that says "it doesn't work".

               It fills the same 16:9 box the player would, so the page does
               not reflow when the problem is fixed and a reload succeeds. */
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-ink-900 px-6 text-center">
              <VideoOff aria-hidden className="size-6 text-ink-400" />
              <p className="text-sm font-semibold text-ink-100">{t('videoUnavailable.title')}</p>
              <p className="max-w-sm text-[0.8125rem] leading-snug text-ink-400">
                {t('videoUnavailable.body')}
              </p>
            </div>
          ))}

        <div className="px-4 py-5 md:px-6">
          <p className="text-[0.8125rem] font-medium text-ink-500">{lesson.section_title}</p>
          <h1 className="mt-0.5 text-xl leading-tight font-semibold tracking-[-0.02em] text-ink-900 md:text-2xl">
            {lesson.title}
          </h1>

          {done && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-jade-700">
              <Check aria-hidden className="size-4" strokeWidth={2.6} />
              {t('done')}
            </p>
          )}

          {/* An article or an ebook chapter. Rendered as text, never as a file
              — there is no column anywhere that could hold a path to a whole
              PDF, so nothing can later be "temporarily" served as one (E32).
              `prose`-style sizing is set explicitly rather than pulled from a
              plugin the project does not use. */}
          {lesson.body && (
            <article className="mt-5 max-w-[68ch] space-y-4 text-[1rem] leading-relaxed text-ink-800">
              {lesson.body.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </article>
          )}

          {resources.length > 0 && (
            <div className="mt-6 rounded-(--radius-card) border border-ink-200 bg-surface">
              <p className="border-b border-ink-200 px-4 py-2.5 text-[0.8125rem] font-semibold text-ink-700">
                {t('resources')}
              </p>
              <ul className="divide-y divide-ink-200">
                {resources.map((resource) => (
                  <li key={resource.id}>
                    {/* Opens a reader, NOT a download. The reference has a
                        download arrow on every row; that is the one thing
                        deliberately not copied. */}
                    <a
                      href={`/api/content/resource/${resource.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 px-4 py-3 text-[0.9375rem] text-ink-800 transition-colors hover:bg-ink-50"
                    >
                      <Paperclip aria-hidden className="size-4 shrink-0 text-ink-500" />
                      <span className="min-w-0 flex-1 truncate">{resource.title}</span>
                      <span className="shrink-0 text-[0.75rem] text-ink-500">{t('read')}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* A section quiz is a lesson of kind `quiz`, so it gets the page
              rather than the video's rectangle. Same component either way. */}
          {standalone && lesson.kind === 'quiz' && (
            <div className="mt-6">
              <LessonQuiz
                quiz={standalone}
                variant="standalone"
                onSubmit={(answers) => onSubmitQuiz(standalone.id, answers)}
                onPassed={() => {
                  setDone(true)
                  router.refresh()
                }}
              />
            </div>
          )}

          {/* Reading has no natural end event the way a video does, so it
              needs a control. Hidden once done — a button that repeats an
              action already taken invites the question of whether it worked. */}
          {(lesson.kind === 'article' || lesson.kind === 'pdf') && !done && (
            <button
              type="button"
              onClick={markRead}
              className={cn(
                'mt-6 rounded-(--radius-input) bg-jade-600 px-4 py-2.5',
                'text-sm font-semibold text-white transition-colors hover:bg-jade-700',
              )}
            >
              {t('markRead')}
            </button>
          )}
        </div>
      </div>

      {/* The curriculum: beneath the content on a phone, beside it from lg.
          `lg:h-dvh lg:overflow-y-auto` so the rail scrolls on its own and a
          long course does not drag the video off the top of the screen. */}
      <aside className="border-t border-ink-200 bg-surface lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <CurriculumList
          sections={sections}
          activeLessonId={lesson.id}
          entitled={entitled}
          slug={slug}
          courseTitle={courseTitle}
        />
      </aside>
    </div>
  )
}
