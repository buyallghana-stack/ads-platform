/**
 * Skip logic, client side.
 *
 * This is a deliberate MIRROR of public.visible_ad_questions in migration 044,
 * and the two must agree. They have different jobs and only one of them is
 * trusted:
 *
 *   here      decides what the player SHOWS next
 *   database  decides what it is entitled to REQUIRE and grade
 *
 * If they ever disagree, the database wins and the user is told the ad is
 * incomplete — annoying, but not exploitable. A player that skipped a question
 * it should have asked earns nothing, because submit_ad_answers recomputes
 * visibility from the submitted answers and still expects that answer.
 *
 * Kept as a pure function with no React and no Supabase so the rule can be
 * read next to the SQL and checked by eye.
 */

export type QuestionRule = {
  /** Question whose answer is being tested. Always EARLIER in position — the
   *  database enforces that with a trigger, so no cycle can reach here. */
  dependsOn: string
  /** For multiple choice: the option that must have been chosen. */
  optionId: string | null
  /** For typed answers: compared case-insensitively and trimmed, exactly as
   *  the database compares it. */
  valueText: string | null
  /** "is not" rather than "is". */
  negate: boolean
}

type Conditional = {
  id: string
  conditionMode: 'all' | 'any'
  rules: QuestionRule[]
}

/**
 * The questions these answers make visible, in the order given.
 *
 * `questions` must already be in the admin's position order — the caller gets
 * them that way from get_ad_questions_for_user, and evaluation depends on it:
 * a rule can only look backwards, so the answer to "is the question I depend
 * on visible?" is only known once earlier questions have been decided.
 */
export function visibleQuestions<T extends Conditional>(
  questions: T[],
  answers: Record<string, string>,
): T[] {
  const shown = new Set<string>()
  const out: T[] = []

  for (const question of questions) {
    if (question.rules.length === 0) {
      shown.add(question.id)
      out.push(question)
      continue
    }

    const results = question.rules.map((rule) => {
      let match = false

      // A rule whose subject was never shown cannot pass. This is what makes a
      // skip cascade: hide Q2 and everything hanging off Q2 stays hidden,
      // rather than its follow-ups leaking back into the survey.
      if (shown.has(rule.dependsOn)) {
        const answer = answers[rule.dependsOn]
        if (answer != null && answer !== '') {
          match = rule.optionId
            ? answer === rule.optionId
            : answer.trim().toLowerCase() === (rule.valueText ?? '').trim().toLowerCase()
        }
      }

      return rule.negate ? !match : match
    })

    const passes =
      question.conditionMode === 'any' ? results.some(Boolean) : results.every(Boolean)

    if (passes) {
      shown.add(question.id)
      out.push(question)
    }
  }

  return out
}

/** Whether an ad branches at all. A survey with no rules shows every question
 *  to everybody, and can therefore show an honest "n of N" progress count;
 *  a branching one cannot, because N is not known until the last answer. */
export function hasBranching(questions: { rules: QuestionRule[] }[]): boolean {
  return questions.some((q) => q.rules.length > 0)
}
