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
    const { data, error } = await supabase.rpc('lesson_for_learner', {
      p_user_id: userId,
      p_lesson_id: lessonId,
    })
    if (error || !data) return { ok: false, reason: 'not-found' }
    return data as unknown as LessonPayload
  },
)

/** Total lessons and how many are done — the header's one line of progress. */
export function courseProgress(sections: Section[]): { done: number; total: number } {
  const lessons = sections.flatMap((s) => s.lessons)
  return { done: lessons.filter((l) => l.completed).length, total: lessons.length }
}
