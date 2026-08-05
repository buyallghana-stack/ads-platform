'use server'

import { getSessionUser } from '@/lib/auth/session'
import { getViewAsSession } from '@/lib/admin/view-as'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Course actions: marking a quiz, and recording how far a video has been
 * watched.
 *
 * ---------------------------------------------------------------------------
 * THESE RUN AS THE SIGNED-IN USER, NEVER THE VIEWED ONE
 *
 * Everywhere else in Phase 2 the reads take a user id so a super admin's
 * "view as user" look renders the viewed account. These do the opposite and
 * use `getSessionUser`, then refuse outright while a look is open.
 *
 * The reason is that these WRITE, and what they write leads to money: quiz
 * passes complete lessons, completed lessons cross the activation threshold,
 * and crossing it makes somebody an affiliate who can earn. An administrator
 * must not be able to advance somebody's course, even accidentally, even with
 * good intent.
 *
 * Middleware already blocks every non-GET while the viewing cookie is set, so
 * this is the second of two locks. It is here rather than trusted to
 * middleware alone because a server action reached by any other path would
 * otherwise be a hole, and the cost of the check is one cookie read.
 */

type QuizResult = { ok: true; score: number; passed: boolean } | { ok: false }

export async function submitQuizAction(
  quizId: string,
  answers: Record<string, string>,
): Promise<QuizResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false }
  if (await getViewAsSession()) return { ok: false }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('submit_quiz_attempt', {
    p_user_id: user.id,
    p_quiz_id: quizId,
    /* The chosen option ids, exactly as given. The marking — and the answer
       key — stay in Postgres; this action never learns which was right. */
    p_answers: answers,
  })

  if (error || !data?.[0]) {
    reportUnexpected(error, 'learn.submitQuiz', { quizId })
    return { ok: false }
  }
  return { ok: true, score: data[0].score_percent, passed: data[0].passed }
}

export async function recordProgressAction(
  lessonId: string,
  seconds: number,
  percent: number,
): Promise<{ ok: boolean }> {
  const user = await getSessionUser()
  if (!user) return { ok: false }
  if (await getViewAsSession()) return { ok: false }

  const supabase = createAdminClient()
  const { error } = await supabase.rpc('record_lesson_progress', {
    p_user_id: user.id,
    p_lesson_id: lessonId,
    /* Floored, and never allowed to go backwards by the RPC itself. A player
       that reports 3 seconds after a seek must not undo 8 minutes of watching. */
    p_seconds: Math.max(0, Math.floor(seconds)),
    p_percent: Math.min(100, Math.max(0, Math.floor(percent))),
  })

  if (error) {
    reportUnexpected(error, 'learn.recordProgress', { lessonId })
    return { ok: false }
  }
  return { ok: true }
}

/** Marks an article or a PDF lesson read. Video lessons settle from progress. */
export async function markReadAction(lessonId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser()
  if (!user) return { ok: false }
  if (await getViewAsSession()) return { ok: false }

  const supabase = createAdminClient()
  const { error } = await supabase.rpc('mark_lesson_read', {
    p_user_id: user.id,
    p_lesson_id: lessonId,
  })
  if (error) {
    reportUnexpected(error, 'learn.markRead', { lessonId })
    return { ok: false }
  }
  return { ok: true }
}
