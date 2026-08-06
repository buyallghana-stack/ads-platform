'use server'

import { revalidatePath } from 'next/cache'

import { getSessionUser } from '@/lib/auth/session'
import { getViewAsSession } from '@/lib/admin/view-as'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Recording progress through a lesson.
 *
 * ── THIS IS A MONEY WRITE, WHICH IS NOT OBVIOUS ──
 *
 * Progress moves `training_completion_percent`, which crosses
 * `activation_threshold_percent`, which switches an affiliate account on. So
 * "I watched a video" is upstream of "this person may now earn real cedis",
 * and this function has to be treated as such.
 *
 * ⚠️ Written for the SIGNED-IN user (`getSessionUser`), never the viewed one,
 * and REFUSED outright while a super admin has a look open. Every Phase 2 READ
 * takes the viewed account so "view as user" shows their screens; writes do the
 * exact opposite, because an admin scrubbing through somebody's video must not
 * activate their ability to earn.
 *
 * ── THE SERVER DECIDES WHAT COUNTS ──
 *
 * The browser reports a position and a percentage. `record_lesson_progress`
 * applies `lesson_pass_percent`, refuses a lesson the caller has not bought,
 * and never lets progress go backwards. Nothing is trusted here beyond "this
 * many seconds were claimed".
 */
export async function markLessonProgress(
  lessonId: string,
  slug: string,
  seconds: number,
  percent: number,
): Promise<void> {
  const user = await getSessionUser()
  if (!user) return

  /* Refused while impersonating. Silently — the person doing it is an admin
     looking at somebody's screen, not a user who needs an error. */
  if (await getViewAsSession()) return

  const admin = createAdminClient()
  await admin.rpc('record_lesson_progress', {
    p_user_id: user.id,
    p_lesson_id: lessonId,
    /* Clamped here as well as in SQL. A negative position is not an attack
       worth a raise, it is a browser rounding a seek to -0.0001. */
    p_seconds: Math.max(0, Math.floor(seconds)),
    p_percent: Math.min(100, Math.max(0, Math.floor(percent))),
    /* Not passed. `p_quiz_passed` is for a checkpoint result, and a video
       reaching its end is not one — defaulting it here would let a lesson with
       a required quiz complete without the quiz. */
  })

  /* The curriculum's tick marks and the dashboard's progress bar both read
     this. Revalidating the course page is enough — the dashboard is a separate
     request and will be fresh when it is next visited. */
  revalidatePath(`/learn/${slug}`)
}

/**
 * Submitting a checkpoint.
 *
 * ── THE GRADING IS IN POSTGRES AND THAT IS THE WHOLE SECURITY MODEL ──
 *
 * `submit_quiz_attempt` compares the answers against `quiz_options.is_correct`
 * and returns only a score. The answer key never leaves the database: neither
 * `quiz_for_learner` nor `lesson_for_learner` selects `is_correct`, so there is
 * nothing in the page for a reader to inspect.
 *
 * That matters more here than on a normal course. Passing a checkpoint
 * completes a lesson, completing lessons crosses `activation_threshold_percent`,
 * and crossing it switches on the ability to earn real money. A quiz graded in
 * the browser would be a money control graded in the browser.
 *
 * ⚠️ Same rule as progress: the SIGNED-IN user, and refused while a super admin
 * has a look open. An admin clicking through somebody's checkpoint must not
 * activate their account.
 */
export async function submitQuiz(
  quizId: string,
  slug: string,
  answers: Record<string, string>,
): Promise<{ score: number; passed: boolean }> {
  const user = await getSessionUser()
  if (!user) return { score: 0, passed: false }
  if (await getViewAsSession()) return { score: 0, passed: false }

  const admin = createAdminClient()
  const { data, error } = await admin
    .rpc('submit_quiz_attempt', {
      p_user_id: user.id,
      p_quiz_id: quizId,
      p_answers: answers,
    })
    .maybeSingle()

  if (error || !data) return { score: 0, passed: false }

  revalidatePath(`/learn/${slug}`)
  return { score: data.score_percent, passed: data.passed }
}
