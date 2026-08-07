import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Read side of the course experience.
 *
 * Same convention as the rest of Phase 2: server-only RPCs through the admin
 * client, taking a user id rather than reading `auth.uid()`, so a super
 * admin's read-only look renders the viewed account's progress.
 */

export type LessonKind = 'video' | 'article' | 'pdf' | 'quiz'

export type CurriculumRow = {
  section_id: string
  section_title: string
  section_position: number
  lesson_id: string
  lesson_title: string
  lesson_position: number
  kind: LessonKind
  duration_seconds: number | null
  word_count: number | null
  resource_count: number
  quiz_count: number
  is_preview: boolean
  completed: boolean
  seconds_watched: number
  watched_percent: number
  /** False when a checkpoint on this lesson is still unpassed. */
  checkpoints_passed: boolean
}

export type Section = {
  id: string
  title: string
  lessons: CurriculumRow[]
}

export type QuizOption = { id: string; body: string }
export type QuizQuestion = { id: string; prompt: string; options: QuizOption[] }
export type Quiz = {
  id: string
  title: string
  /** `null` for a standalone section quiz; a number for a video checkpoint. */
  at_seconds: number | null
  pass_percent: number
  questions: QuizQuestion[]
  /** Merged in by `getLesson`. A checkpoint already passed is closed, and it
   *  is what decides whether the lesson can be moved past. */
  passed: boolean
}

export type LessonPayload =
  | { ok: false; reason: 'not-found' | 'locked' }
  | {
      ok: true
      lesson: {
        id: string
        title: string
        kind: LessonKind
        section_title: string
        product_id: string
        duration_seconds: number | null
        is_preview: boolean
        body: string | null
      }
      progress: {
        seconds_watched: number
        watched_percent: number
        quiz_passed: boolean
        completed: boolean
      }
      resources: { id: string; title: string; byte_size: number | null }[]
      quizzes: Quiz[]
      /** False while any checkpoint on this lesson is unpassed. Next is
       *  blocked on it: a checkpoint that can be walked past is decoration,
       *  and the certificate now depends on the score. */
      checkpointsPassed: boolean
    }

/**
 * The curriculum, already grouped into sections.
 *
 * The RPC returns one flat row per lesson because that is the shape SQL is
 * good at. Grouping happens here rather than in Postgres so the ordering is
 * done once, in code that is easy to read, instead of inside a nested
 * aggregate that is easy to get subtly wrong.
 */
export const getCurriculum = cache(
  async (productId: string, userId: string): Promise<Section[]> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('course_curriculum', {
      p_product_id: productId,
      p_user_id: userId,
    })
    if (error || !data) return []

    const rows = data as unknown as CurriculumRow[]
    const sections: Section[] = []
    for (const row of rows) {
      let section = sections.find((s) => s.id === row.section_id)
      if (!section) {
        section = { id: row.section_id, title: row.section_title, lessons: [] }
        sections.push(section)
      }
      section.lessons.push(row)
    }
    return sections
  },
)

export const getLesson = cache(
  async (userId: string, lessonId: string): Promise<LessonPayload> => {
    const supabase = createAdminClient()

    /* Two calls rather than one, deliberately. `lesson_for_learner` is the
       content read and it is careful about what it does NOT send — the answer
       key never leaves the database. The pass state is a different question
       about the same person, and bolting it into that function would mean
       editing forty lines of jsonb to add one boolean per quiz. */
    const [lesson, states] = await Promise.all([
      supabase.rpc('lesson_for_learner', { p_user_id: userId, p_lesson_id: lessonId }),
      supabase.rpc('lesson_quiz_states', { p_user_id: userId, p_lesson_id: lessonId }),
    ])

    if (lesson.error || !lesson.data) return { ok: false, reason: 'not-found' }

    const payload = lesson.data as unknown as LessonPayload
    if (!payload.ok) return payload

    const passedById = (states.data ?? {}) as Record<string, boolean>
    payload.quizzes = payload.quizzes.map((quiz) => ({
      ...quiz,
      passed: passedById[quiz.id] === true,
    }))
    payload.checkpointsPassed = payload.quizzes.every((quiz) => quiz.passed)

    return payload
  },
)

/** Total lessons and how many are done — the header's one line of progress. */
export function courseProgress(sections: Section[]): { done: number; total: number } {
  const lessons = sections.flatMap((s) => s.lessons)
  return { done: lessons.filter((l) => l.completed).length, total: lessons.length }
}

export type CourseResource = {
  resource_id: string
  title: string
  byte_size: number | null
  lesson_id: string
  lesson_title: string
  section_title: string
}

/** Everything attached to the course, for the Resources tab. */
export const getCourseResources = cache(
  async (productId: string, userId: string): Promise<CourseResource[]> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('course_resources', {
      p_product_id: productId,
      p_user_id: userId,
    })
    if (error || !data) return []
    return data as unknown as CourseResource[]
  },
)

/**
 * A lesson's length as the reference writes it: `05:25`, and `06:03` for what
 * is left of one already started.
 *
 * Minutes and seconds, not the `5m` the shop cards use. On a card, "5m" is a
 * shopping figure — is this course two hours or ten. Inside the player it is a
 * scheduling one: somebody is deciding whether to start this lesson now, and
 * the difference between 5:05 and 5:55 is the whole question. Padded so the
 * column does not jitter as the numbers change.
 */
export function clock(seconds: number): string | null {
  if (!seconds || seconds < 1) return null
  const whole = Math.round(seconds)
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * What is left of a lesson, or null when that is not a useful thing to say.
 *
 * Null on a finished lesson (the tick already says it) and on an untouched one
 * (its length already says it). "Remaining" is only information in the middle,
 * which is exactly where the reference shows it.
 */
export function remaining(row: {
  duration_seconds: number | null
  seconds_watched: number
  completed: boolean
}): string | null {
  if (row.completed || !row.duration_seconds) return null
  const left = row.duration_seconds - row.seconds_watched
  if (row.seconds_watched < 5 || left < 5) return null
  return clock(left)
}

export type Neighbour = { id: string; title: string } | null

/**
 * The lesson before and after this one, in curriculum order.
 *
 * Flattened ACROSS sections, because "next" means the next thing to study, not
 * the next thing in this section — stopping at a section boundary would strand
 * somebody at the end of section one with a dead button and no clue that there
 * are four more sections under it.
 *
 * Computed here rather than fetched: the page already holds the whole
 * curriculum to draw the list, so asking the database again for two rows it is
 * already holding would be a query to save an array lookup.
 */
export function neighbours(
  sections: Section[],
  lessonId: string | null,
): { previous: Neighbour; next: Neighbour } {
  const flat = sections.flatMap((s) => s.lessons)
  const at = flat.findIndex((l) => l.lesson_id === lessonId)
  if (at < 0) return { previous: null, next: null }

  const name = (row: CurriculumRow | undefined): Neighbour =>
    row ? { id: row.lesson_id, title: row.lesson_title } : null

  return { previous: name(flat[at - 1]), next: name(flat[at + 1]) }
}
