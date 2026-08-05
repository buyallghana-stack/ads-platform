'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { LessonQuiz } from '@/components/market/LessonQuiz'
import { cn } from '@/lib/cn'
import type { Quiz } from '@/lib/market/course'

/**
 * The video player, and the in-video checkpoint that interrupts it.
 *
 * ---------------------------------------------------------------------------
 * THE CHECKPOINT REPLACES THE FRAME
 *
 * There is no reference anywhere for this interaction, so it is derived from
 * what it is FOR (DESIGN.md call 4). Passing a checkpoint contributes to
 * completing a lesson, completing lessons makes an affiliate, and affiliates
 * earn real money. So it has to be genuinely unskippable, which rules out the
 * two obvious implementations:
 *
 *   a dismissible overlay        — dismissible is skippable
 *   a modal over a playing video — the video runs past the checkpoint behind it
 *
 * Instead the video PAUSES and the quiz takes over the same rectangle. Same
 * position, same width; nothing on the page moves. Because the player is
 * sticky, the quiz inherits that stickiness, which is the actual point:
 *
 *     A quiz you can scroll away from is a quiz you can skip.
 *
 * On a phone the frame is around 200px tall and a question plus four options
 * does not fit inside it, so the block grows to the height it needs and pushes
 * the list down. Replacing the frame permits that; an overlay would not.
 *
 * ---------------------------------------------------------------------------
 * SEEKING CANNOT JUMP A CHECKPOINT
 *
 * Without this the whole mechanism is decorative: drag the scrubber past 4:32
 * and the checkpoint never fires. `onSeeking` clamps the playhead back to the
 * earliest unanswered checkpoint. Seeking BACKWARDS is untouched — rewatching
 * is exactly what somebody who failed a checkpoint should be doing.
 */
export function LessonPlayer({
  src,
  poster,
  quizzes,
  startAt,
  isPreview,
  onProgress,
  onSubmitQuiz,
  onAllPassed,
}: {
  src: string
  poster?: string
  /** Only checkpoints — those with an `at_seconds`. Sorted ascending. */
  quizzes: Quiz[]
  /** Where they left off, in seconds. */
  startAt: number
  isPreview: boolean
  /** Throttled progress reporting. Seconds and whole percent. */
  onProgress: (seconds: number, percent: number) => void
  onSubmitQuiz: (
    quizId: string,
    answers: Record<string, string>,
  ) => Promise<{ score: number; passed: boolean }>
  onAllPassed: () => void
}) {
  const t = useTranslations('market.course')
  const video = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState<Quiz | null>(null)
  const [passed, setPassed] = useState<Set<string>>(new Set())
  const lastReport = useRef(0)

  const pending = useCallback(
    (at: number) =>
      quizzes.filter((q) => q.at_seconds !== null && q.at_seconds <= at && !passed.has(q.id)),
    [quizzes, passed],
  )

  /* Resume where they left off. Set once the metadata is in, because setting
     currentTime before the browser knows the duration is silently ignored. */
  const onLoadedMetadata = useCallback(() => {
    const el = video.current
    if (el && startAt > 0 && startAt < el.duration) el.currentTime = startAt
  }, [startAt])

  const onTimeUpdate = useCallback(() => {
    const el = video.current
    if (!el || active) return

    const due = pending(el.currentTime)[0]
    if (due) {
      el.pause()
      setActive(due)
      return
    }

    /* Report at most once every 5 seconds. A `timeupdate` fires 4–66 times a
       second depending on the browser; writing progress on every one would put
       a row on the wire several times a second on a mobile connection. */
    if (el.currentTime - lastReport.current >= 5) {
      lastReport.current = el.currentTime
      const percent = el.duration ? Math.floor((el.currentTime / el.duration) * 100) : 0
      onProgress(Math.floor(el.currentTime), percent)
    }
  }, [active, pending, onProgress])

  /* The clamp. Without it the scrubber walks straight past every checkpoint. */
  const onSeeking = useCallback(() => {
    const el = video.current
    if (!el) return
    const blocked = quizzes.find(
      (q) => q.at_seconds !== null && q.at_seconds < el.currentTime && !passed.has(q.id),
    )
    if (blocked && blocked.at_seconds !== null) el.currentTime = blocked.at_seconds
  }, [quizzes, passed])

  const onEnded = useCallback(() => {
    const el = video.current
    if (!el) return
    onProgress(Math.floor(el.duration), 100)
    if (quizzes.every((q) => passed.has(q.id))) onAllPassed()
  }, [onProgress, quizzes, passed, onAllPassed])

  /* Keep the reported position honest when somebody navigates away mid-video.
     Without this, closing the tab at 4:00 loses everything since the last
     5-second tick. */
  useEffect(() => {
    const el = video.current
    return () => {
      if (el && el.currentTime > 0 && el.duration) {
        onProgress(Math.floor(el.currentTime), Math.floor((el.currentTime / el.duration) * 100))
      }
    }
  }, [onProgress])

  function resume(quizId: string) {
    setPassed((p) => new Set(p).add(quizId))
    setActive(null)
    // Let the frame come back before asking it to play, or Safari rejects the
    // promise for a video that is still display:none.
    requestAnimationFrame(() => void video.current?.play())
  }

  return (
    /* STICKY is the whole mobile design. The list scrolls beneath; the video —
       and therefore a checkpoint — never leaves the screen. At lg the layout
       becomes two columns and stickiness is no longer what holds it together,
       but it costs nothing to keep. */
    <div className="sticky top-0 z-20 bg-ink-900">
      {active ? (
        <LessonQuiz
          quiz={active}
          variant="checkpoint"
          onSubmit={(answers) => onSubmitQuiz(active.id, answers)}
          onPassed={() => resume(active.id)}
          /* A preview lesson may be skipped — it is a sample, and nothing in
             it counts towards activation. A paid lesson never offers this. */
          onDismiss={isPreview ? () => resume(active.id) : undefined}
        />
      ) : (
        <video
          ref={video}
          src={src}
          poster={poster}
          controls
          controlsList="nodownload"
          disablePictureInPicture={false}
          playsInline
          preload="metadata"
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onSeeking={onSeeking}
          onEnded={onEnded}
          className={cn('aspect-video w-full bg-black')}
        >
          {t('noVideo')}
        </video>
      )}
    </div>
  )
}
