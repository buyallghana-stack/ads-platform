import { describe, expect, it } from 'vitest'

import { nextDueQuestion, visibleQuestions } from '@/lib/ads/visibility'

/**
 * WHICH QUESTION OPENS NEXT, AND WHETHER THE VIDEO IS RETURNED TO.
 *
 * ── THE BUG THIS FILE EXISTS FOR ──
 *
 * Operator, 2026-08-13, on a video ad in the Bronze bucket carrying two
 * questions BOTH set at the end of the film:
 *
 *   "the video ended and a question came, i answered and instead of a follow
 *    up question, the ad started for the ad to end before i could answer the
 *    next question."
 *
 * AdPlayer had one rule for "questions remain": go back to the video and let
 * the clock raise them. Correct for a cue in the future. Ruinous for a cue in
 * the past and for a question with no cue at all, because by then the film has
 * finished, and asking a finished player to play does not resume it, it
 * REWINDS it. Both sources do this: YouTube's playVideo() on an ENDED player
 * and a plain <video>'s play() after `ended` both restart from zero.
 *
 * So the second question was unreachable until the whole advert had played
 * again, and the button that got you there said "Continue watching", which is
 * how it looked like the ad had "started" on its own.
 *
 * ── WHY THIS IS A PURE TEST AND NOT A BROWSER ONE ──
 *
 * The decision is a function of three things: the questions still to ask, the
 * clock, and whether the film is over. None of that needs a video element, a
 * network, or the database, and a test that had to load YouTube to check a
 * comparison would fail for reasons that have nothing to do with the rule.
 * The player's job is reduced to calling this with the right arguments, which
 * is the part a reader can check by eye.
 *
 * Note this file needs no SUPABASE_DB_URL, unlike everything under money/.
 */

const q = (id: string, showAtSeconds: number | null = null) => ({
  id,
  showAtSeconds,
  conditionMode: 'all' as const,
  rules: [],
})

describe('the question that opens next', () => {
  it('asks nothing when nothing is left', () => {
    expect(nextDueQuestion([], { elapsed: 30, filmOver: true })).toBeNull()
  })

  it('holds an end-of-film question back while the film is still running', () => {
    // No cue means "ask it at the end". The player returns to the video for
    // it, which is the ONLY case where returning to the video is right.
    expect(nextDueQuestion([q('a')], { elapsed: 5, filmOver: false })).toBeNull()
  })

  it('opens an end-of-film question the moment the film is over', () => {
    expect(nextDueQuestion([q('a')], { elapsed: 60, filmOver: true })?.id).toBe('a')
  })

  it('opens a cue the clock has reached, and not one it has not', () => {
    const pending = [q('early', 10), q('late', 45)]
    expect(nextDueQuestion(pending, { elapsed: 12, filmOver: false })?.id).toBe('early')
    expect(nextDueQuestion([q('late', 45)], { elapsed: 12, filmOver: false })).toBeNull()
  })

  it('treats the cue second itself as reached, not as still ahead', () => {
    // A 4 Hz tick lands ON the second often enough that > and >= are a real
    // difference: at > the cue fires 250ms late, every time.
    expect(nextDueQuestion([q('a', 10)], { elapsed: 10, filmOver: false })?.id).toBe('a')
  })

  it('lets two questions share one cue second, back to back', () => {
    // Previously these flickered: answering the first returned to the video
    // and the next 250ms tick brought the second one up.
    const both = [q('a', 10), q('b', 10)]
    expect(nextDueQuestion(both, { elapsed: 10, filmOver: false })?.id).toBe('a')
    expect(nextDueQuestion([both[1]!], { elapsed: 10, filmOver: false })?.id).toBe('b')
  })

  it('rescues a cue set past the end of the film', () => {
    // An admin can put a cue at 90s on a 60s film. The clock never reaches it,
    // so before this rule the question was unreachable and the ad could not be
    // finished at all.
    expect(nextDueQuestion([q('a', 90)], { elapsed: 60, filmOver: true })?.id).toBe('a')
  })

  it('decides ties by the admin position order it was handed', () => {
    const pending = [q('first'), q('second')]
    expect(nextDueQuestion(pending, { elapsed: 60, filmOver: true })?.id).toBe('first')
  })
})

describe("the operator's ad: two questions, both at the end", () => {
  /**
   * The whole watch, as the player runs it. What is being asserted is not just
   * that both questions get asked, but that the video is NEVER returned to
   * between them, because returning to it is what rewound the advert.
   */
  it('asks the second question straight after the first, without replaying', () => {
    const questions = [q('q1'), q('q2')]
    const asked: string[] = []
    const answers: Record<string, string> = {}
    let returnedToVideo = 0

    // The film runs out. handleEnded asks the first thing still pending.
    let filmOver = true
    const elapsed = 30

    for (let step = 0; step < 10; step += 1) {
      const pending = visibleQuestions(questions, answers).filter((x) => !asked.includes(x.id))
      const due = nextDueQuestion(pending, { elapsed, filmOver })

      if (due) {
        asked.push(due.id)
        answers[due.id] = 'an answer'
        continue
      }
      if (pending.length > 0) {
        // This is the branch that caused the bug. Reaching it here would mean
        // the player went back to a finished film.
        returnedToVideo += 1
        filmOver = true // ...and the replay would eventually end again
        continue
      }
      break
    }

    expect(asked).toEqual(['q1', 'q2'])
    expect(returnedToVideo).toBe(0)
  })

  it('still returns to the video when the questions are genuinely mid-roll', () => {
    // The counter-case, so the fix above cannot be "never go back to the
    // video", which would ask every question at second zero.
    const questions = [q('q1', 10), q('q2', 40)]
    const answers: Record<string, string> = { q1: 'an answer' }
    const pending = visibleQuestions(questions, answers).filter((x) => x.id !== 'q1')

    expect(nextDueQuestion(pending, { elapsed: 10, filmOver: false })).toBeNull()
    expect(nextDueQuestion(pending, { elapsed: 40, filmOver: false })?.id).toBe('q2')
  })
})

describe('branching still decides what is pending', () => {
  it('does not ask a question the answers have hidden', () => {
    const questions = [
      q('q1'),
      {
        id: 'q2',
        showAtSeconds: null,
        conditionMode: 'all' as const,
        rules: [{ dependsOn: 'q1', optionId: 'yes', valueText: null, negate: false }],
      },
    ]
    const answers = { q1: 'no' }
    const pending = visibleQuestions(questions, answers).filter((x) => x.id !== 'q1')

    expect(pending).toHaveLength(0)
    expect(nextDueQuestion(pending, { elapsed: 60, filmOver: true })).toBeNull()
  })
})
