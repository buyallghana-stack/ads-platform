import { ctaProblem, type CtaLink } from '@/lib/ads/cta'

import type {
  AdDraft,
  AdOptionDraft,
  AdQuestionDraft,
  AdRuleDraft,
  AdFormat,
} from './types'

/**
 * The ad editor's rules, as pure functions.
 *
 * No React, no Supabase, no translation — this module is imported by the
 * client form AND by the server action that saves what the form produces, so
 * that the two cannot disagree about what a valid ad is. The server does not
 * trust the client's verdict; it recomputes it with the same code.
 *
 * Error values are message KEYS, not sentences. The form renders them through
 * next-intl and the action returns them for the form to render — the same
 * convention the auth schemas already use.
 *
 * None of this replaces the database's own constraints. `ads_video_shape`,
 * `ad_questions_shortext_has_answer`, `ad_question_options_one_correct_idx`
 * and the backward-rule trigger are the real enforcement. What is here exists
 * so an operator is told what is wrong while they are typing, instead of
 * being handed a Postgres error after the save.
 */

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

let counter = 0

/** Local identity for a draft row. Never stored, never sent. */
export function draftKey(prefix = 'k'): string {
  counter += 1
  return `${prefix}${counter}_${Math.random().toString(36).slice(2, 8)}`
}

/* ------------------------------------------------------------------ */
/* Blanks                                                              */
/* ------------------------------------------------------------------ */

export function blankOption(): AdOptionDraft {
  return { key: draftKey('o'), text: '', correct: false }
}

export function blankQuestion(format: AdFormat): AdQuestionDraft {
  return {
    key: draftKey('q'),
    text: '',
    format: 'multiple_choice',
    correctAnswer: null,
    // A video question defaults to the end of the film; the operator moves it
    // to a cue point deliberately. A survey has no timeline at all.
    showAtSeconds: null,
    conditionMode: 'all',
    options: format === 'survey' ? [blankOption(), blankOption()] : [blankOption(), blankOption()],
    rules: [],
  }
}

/**
 * A new ad of the given format.
 *
 * `linkDwellSeconds` comes from `link_dwell_seconds_default`, which is the
 * operator's one lever over how hard this format is to farm. It is passed in
 * rather than read here because this module is pure — and defaulted to the
 * same 15 the config row ships with, so a caller that cannot reach the
 * database still produces a legal ad rather than one the shape constraint
 * rejects.
 */
export function blankDraft(format: AdFormat, linkDwellSeconds = 15): AdDraft {
  return {
    id: null,
    title: '',
    description: '',
    advertiser: '',
    format,
    // Nothing is ever created live. An ad reaches the pool because somebody
    // read it back and chose to publish it.
    status: 'draft',
    // A link ad asks for a read and one tap, which is less of somebody's day
    // than a survey and less than sitting through a film — so it starts
    // cheaper. Every one of these is only a starting point in a field.
    points: format === 'survey' ? 80 : format === 'link' ? 25 : 40,
    videoSource: format === 'video' ? 'youtube' : null,
    storagePath: null,
    youtubeId: null,
    thumbnailPath: null,
    durationSeconds: null,
    // On a link ad this is the reading time before the link will pay, and the
    // database requires it — so it is never null for one.
    minWatchSeconds: format === 'link' ? linkDwellSeconds : null,
    maxCompletions: 5000,
    weight: 100,
    startsAt: null,
    endsAt: null,
    tierIds: [],
    questions: [],
    ctaLabel: '',
    // A link ad IS a call to action, so it starts with the one row it must
    // end up with rather than making the operator go and find the button.
    ctaLinks: format === 'link' ? [{ kind: 'website', value: '' }] : [],
    articleBody: '',
    completions: 0,
    attempts: 0,
    questionsLocked: false,
  }
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The 11-character id out of whatever the operator pasted.
 *
 * They will paste a full watch URL, a share link, an embed, or a Shorts URL,
 * because that is what the browser gives them — and the column stores the id,
 * because that is what the player needs. Refusing anything but a bare id
 * would be the screen making its own storage decision somebody else's problem.
 */
export function youtubeId(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (YT_ID.test(value)) return value

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0]
      return YT_ID.test(id) ? id : null
    }

    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v')
      if (v && YT_ID.test(v)) return v
      const parts = url.pathname.split('/').filter(Boolean)
      // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
      if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
        return YT_ID.test(parts[1]) ? parts[1] : null
      }
    }
  } catch {
    return null
  }

  return null
}

/* ------------------------------------------------------------------ */
/* Reading a question                                                  */
/* ------------------------------------------------------------------ */

/**
 * Whether a question has an answer key — the one rule migration 043 turned
 * into product law. A key makes it GRADED; no key makes it an opinion
 * question, where any answer is accepted and still recorded.
 */
export function isGraded(question: AdQuestionDraft): boolean {
  return question.format === 'short_text'
    ? Boolean(question.correctAnswer && question.correctAnswer.trim())
    : question.options.some((o) => o.correct)
}

/** Whether an ad branches at all. */
export function hasBranching(questions: AdQuestionDraft[]): boolean {
  return questions.some((q) => q.rules.length > 0)
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type AdErrors = Record<string, string>

/* The article's limits are `ads_article_body_length`, and the dwell time's are
   the min/max on `link_dwell_seconds_default` — both from migration 090. They
   are named here so the form can show a counter against the same number the
   database will judge the save by. */
export const ARTICLE_MIN = 40
export const ARTICLE_MAX = 8000
export const DWELL_MIN = 3
export const DWELL_MAX = 600

/**
 * Field paths used as error keys:
 *   title, points, weight, budget, media, duration, minWatch, schedule,
 *   article, ctaLabel, ctaLinks, cta.<index>
 *   q.<key>.text, q.<key>.options, q.<key>.answer, q.<key>.cue, q.<key>.rules
 */
export function validateAd(draft: AdDraft): AdErrors {
  const errors: AdErrors = {}

  const title = draft.title.trim()
  if (title.length < 2) errors.title = 'titleShort'
  else if (title.length > 200) errors.title = 'titleLong'

  if (!Number.isFinite(draft.points) || draft.points < 1) errors.points = 'pointsMin'
  else if (draft.points > 100_000) errors.points = 'pointsMax'

  if (!Number.isFinite(draft.weight) || draft.weight < 1) errors.weight = 'weightMin'

  if (draft.maxCompletions !== null && draft.maxCompletions < 1) errors.budget = 'budgetMin'
  // Lowering the budget under what has already been delivered would exhaust
  // the ad the instant it saved, which is not what "reduce the budget" means
  // to the person typing it.
  if (draft.maxCompletions !== null && draft.maxCompletions < draft.completions) {
    errors.budget = 'budgetBelowDelivered'
  }

  if (draft.format === 'video') {
    if (draft.videoSource === 'youtube' && !draft.youtubeId) errors.media = 'youtubeMissing'
    if (draft.videoSource === 'upload' && !draft.storagePath) errors.media = 'uploadMissing'
    if (!draft.videoSource) errors.media = 'sourceMissing'

    if (draft.durationSeconds !== null && draft.durationSeconds < 1) errors.duration = 'durationMin'
    if (draft.minWatchSeconds !== null && draft.minWatchSeconds < 0) errors.minWatch = 'minWatchMin'
    if (
      draft.minWatchSeconds !== null &&
      draft.durationSeconds !== null &&
      draft.minWatchSeconds > draft.durationSeconds
    ) {
      errors.minWatch = 'minWatchOverDuration'
    }
    // An ad with no question pays on watch time alone, so the clock is the
    // only proof of attention there is and it has to be knowable.
    if (draft.questions.length === 0 && draft.durationSeconds === null) {
      errors.duration = 'durationRequiredWatchOnly'
    }
  }

  /*
    The link ad's own shape, mirroring `ads_video_shape` (migration 090) field
    by field. Everything here is a hard database constraint, so the point of
    repeating it is only that the operator is told which field is wrong while
    they are typing, instead of being handed a constraint name after a save.
  */
  if (draft.format === 'link') {
    const article = draft.articleBody.trim()
    if (article.length < ARTICLE_MIN) errors.article = 'articleShort'
    else if (article.length > ARTICLE_MAX) errors.article = 'articleLong'

    // The dwell time is the only brake this format has: without it the ad is
    // a button that prints points. The database refuses a link ad without
    // one, and refuses anything under three seconds.
    if (draft.minWatchSeconds === null) errors.minWatch = 'dwellRequired'
    else if (draft.minWatchSeconds < DWELL_MIN) errors.minWatch = 'dwellMin'
    else if (draft.minWatchSeconds > DWELL_MAX) errors.minWatch = 'dwellMax'
  }

  if (draft.startsAt && draft.endsAt && new Date(draft.endsAt) <= new Date(draft.startsAt)) {
    errors.schedule = 'scheduleOrder'
  }

  // The call to action. Never on a survey — the database has a check
  // constraint for it, so a survey carrying one would be rejected with a
  // constraint name instead of a sentence. A link ad must carry EXACTLY one:
  // it is the destination, not an extra.
  if (draft.format === 'video' || draft.format === 'link') {
    const label = draft.ctaLabel.trim()
    if (label && (label.length < 2 || label.length > 40)) errors.ctaLabel = 'ctaLabelLength'
    draft.ctaLinks.forEach((link, index) => {
      const problem = ctaProblem(link)
      if (problem) errors[`cta.${index}`] = problem
    })

    if (draft.format === 'link') {
      const filled = draft.ctaLinks.filter((link) => link.value.trim())
      if (filled.length === 0) errors.ctaLinks = 'linkDestinationMissing'
      else if (filled.length > 1) errors.ctaLinks = 'linkOneDestination'
    } else if (draft.ctaLinks.length > 6) {
      errors.ctaLinks = 'ctaTooMany'
    }
  }

  // A survey with no questions is not a survey. A video with none is a
  // legitimate watch-only spot.
  if (draft.format === 'survey' && draft.questions.length === 0) {
    errors.questions = 'surveyNeedsQuestion'
  }

  draft.questions.forEach((question, index) => {
    const at = `q.${question.key}`
    const text = question.text.trim()
    if (text.length < 3) errors[`${at}.text`] = 'questionShort'
    else if (text.length > 500) errors[`${at}.text`] = 'questionLong'

    if (question.format === 'multiple_choice') {
      const filled = question.options.filter((o) => o.text.trim())
      if (filled.length < 2) errors[`${at}.options`] = 'optionsTwo'
      else if (question.options.some((o) => o.text.trim().length > 200)) {
        errors[`${at}.options`] = 'optionLong'
      } else if (question.options.some((o) => !o.text.trim())) {
        errors[`${at}.options`] = 'optionEmpty'
      }
      // The database has a unique partial index for this; catching it here
      // means an explanation instead of a constraint name.
      if (question.options.filter((o) => o.correct).length > 1) {
        errors[`${at}.options`] = 'optionsOneCorrect'
      }
    } else if (question.correctAnswer !== null && !question.correctAnswer.trim()) {
      errors[`${at}.answer`] = 'answerBlank'
    }

    if (draft.format === 'video' && question.showAtSeconds !== null) {
      if (question.showAtSeconds < 0) errors[`${at}.cue`] = 'cueMin'
      else if (draft.durationSeconds !== null && question.showAtSeconds > draft.durationSeconds) {
        errors[`${at}.cue`] = 'cueOverDuration'
      }
    }

    // Rules may only look backwards — the database enforces it with a
    // trigger, and a forward rule is unanswerable at the moment it is
    // evaluated. Reordering questions is how an editor creates one by
    // accident, so it is checked on the whole draft rather than at the point
    // the rule was added.
    for (const rule of question.rules) {
      const subject = draft.questions.findIndex((q) => q.key === rule.dependsOn)
      if (subject === -1 || subject >= index) {
        errors[`${at}.rules`] = 'ruleForward'
        break
      }
      const on = draft.questions[subject]
      if (on.format === 'multiple_choice') {
        if (!rule.optionKey || !on.options.some((o) => o.key === rule.optionKey)) {
          errors[`${at}.rules`] = 'ruleOptionMissing'
          break
        }
      } else if (!rule.valueText || !rule.valueText.trim()) {
        errors[`${at}.rules`] = 'ruleValueMissing'
        break
      }
    }
  })

  return errors
}

/* ------------------------------------------------------------------ */
/* To and from the database shape                                      */
/* ------------------------------------------------------------------ */

type Payload = {
  ad: Record<string, unknown>
  questions: Record<string, unknown>[]
  /** Null means "everyone", which is what no rows in ad_tiers means. */
  tierIds: string[] | null
}

/**
 * The draft as admin_save_ad wants it: local keys resolved to the indexes the
 * function reads rules with, empty strings resolved to nulls.
 */
export function adDraftPayload(draft: AdDraft): Payload {
  const trimmed = (value: string) => {
    const v = value.trim()
    return v === '' ? null : v
  }

  const video = draft.format === 'video'
  const link = draft.format === 'link'
  /* Both formats that may carry a destination. A survey sends an empty list
     and no label, which is what ads_cta_video_or_link requires. */
  const linked = video || link
  const questionIndex = new Map(draft.questions.map((q, i) => [q.key, i]))

  return {
    ad: {
      id: draft.id,
      title: draft.title.trim(),
      description: trimmed(draft.description),
      advertiser_name: trimmed(draft.advertiser),
      format: draft.format,
      status: draft.status,
      points_reward: draft.points,
      video_source: video ? draft.videoSource : null,
      storage_path: video && draft.videoSource === 'upload' ? draft.storagePath : null,
      youtube_video_id: video && draft.videoSource === 'youtube' ? draft.youtubeId : null,
      thumbnail_path: draft.thumbnailPath,
      duration_seconds: video ? draft.durationSeconds : null,
      // On a link ad this column is the reading time before the link pays —
      // the same column, doing the same job for `submit_ad_answers`, which is
      // exactly why the format needed no second money path.
      min_watch_seconds: video || link ? draft.minWatchSeconds : null,
      max_completions: draft.maxCompletions,
      weight: draft.weight,
      starts_at: draft.startsAt,
      ends_at: draft.endsAt,
      // A survey sends an empty list and no label, which is what the
      // ads_cta_video_or_link constraint requires.
      cta_label: linked ? trimmed(draft.ctaLabel) : null,
      cta_links: linked
        ? draft.ctaLinks
            .filter((entry) => entry.value.trim())
            .map((entry) => ({ kind: entry.kind, value: entry.value.trim() }))
        : [],
      // Only a link ad has one, and the constraint refuses anything else
      // carrying an article.
      article_body: link ? trimmed(draft.articleBody) : null,
    },
    questions: draft.questions.map((question) => {
      const multi = question.format === 'multiple_choice'
      const options = multi ? question.options.filter((o) => o.text.trim()) : []

      return {
        question_text: question.text.trim(),
        answer_format: question.format,
        correct_answer: multi ? null : trimmed(question.correctAnswer ?? ''),
        show_at_seconds: video ? question.showAtSeconds : null,
        condition_mode: question.conditionMode,
        options: options.map((o) => ({ option_text: o.text.trim(), is_correct: o.correct })),
        rules: question.rules.map((rule) => {
          const dependsOnIndex = questionIndex.get(rule.dependsOn) ?? 0
          const on = draft.questions[dependsOnIndex]
          const optionIndex =
            on && on.format === 'multiple_choice' && rule.optionKey
              ? on.options.filter((o) => o.text.trim()).findIndex((o) => o.key === rule.optionKey)
              : null

          return {
            depends_on_index: dependsOnIndex,
            option_index: optionIndex === null || optionIndex < 0 ? null : optionIndex,
            value_text: on && on.format === 'short_text' ? trimmed(rule.valueText ?? '') : null,
            negate: rule.negate,
          }
        }),
      }
    }),
    tierIds: draft.tierIds.length > 0 ? draft.tierIds : null,
  }
}

/* ---- The other direction ------------------------------------------------ */

type RawRule = {
  depends_on_index: number
  option_index: number | null
  value_text: string | null
  negate: boolean
}

type RawQuestion = {
  question_text: string
  answer_format: 'multiple_choice' | 'short_text'
  correct_answer: string | null
  show_at_seconds: number | null
  condition_mode: 'all' | 'any'
  options: { option_text: string; is_correct: boolean }[]
  rules: RawRule[]
}

export type RawAd = {
  id: string
  title: string
  description: string | null
  advertiser_name: string | null
  format: AdFormat
  status: AdDraft['status']
  points_reward: number
  video_source: 'upload' | 'youtube' | null
  storage_path: string | null
  youtube_video_id: string | null
  thumbnail_path: string | null
  duration_seconds: number | null
  min_watch_seconds: number | null
  max_completions: number | null
  weight: number
  starts_at: string | null
  ends_at: string | null
  cta_label: string | null
  cta_links: CtaLink[] | null
  article_body: string | null
  completions_count: number
  attempts_count: number
  questions_locked: boolean
  tier_ids: string[]
  questions: RawQuestion[]
}

/** admin_get_ad's payload as a working draft, indexes resolved to local keys. */
export function draftFromRaw(raw: RawAd): AdDraft {
  const questions: AdQuestionDraft[] = raw.questions.map((question) => ({
    key: draftKey('q'),
    text: question.question_text,
    format: question.answer_format,
    correctAnswer: question.correct_answer,
    showAtSeconds: question.show_at_seconds,
    conditionMode: question.condition_mode,
    options: question.options.map((option) => ({
      key: draftKey('o'),
      text: option.option_text,
      correct: option.is_correct,
    })),
    rules: [],
  }))

  // Second pass, once every question and option has a key to point at.
  raw.questions.forEach((question, index) => {
    questions[index].rules = question.rules.map<AdRuleDraft>((rule) => {
      const on = questions[rule.depends_on_index]
      return {
        key: draftKey('r'),
        dependsOn: on?.key ?? '',
        optionKey:
          rule.option_index === null ? null : (on?.options[rule.option_index]?.key ?? null),
        valueText: rule.value_text,
        negate: rule.negate,
      }
    })
  })

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? '',
    advertiser: raw.advertiser_name ?? '',
    format: raw.format,
    status: raw.status,
    points: Number(raw.points_reward),
    videoSource: raw.video_source,
    storagePath: raw.storage_path,
    youtubeId: raw.youtube_video_id,
    thumbnailPath: raw.thumbnail_path,
    durationSeconds: raw.duration_seconds,
    minWatchSeconds: raw.min_watch_seconds,
    maxCompletions: raw.max_completions,
    weight: raw.weight,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    tierIds: raw.tier_ids ?? [],
    questions,
    ctaLabel: raw.cta_label ?? '',
    ctaLinks: raw.cta_links ?? [],
    articleBody: raw.article_body ?? '',
    completions: raw.completions_count,
    attempts: raw.attempts_count,
    questionsLocked: raw.questions_locked,
  }
}

/** A copy of an ad, ready to be created as a new one. */
export function duplicateDraft(draft: AdDraft, titleSuffix: string): AdDraft {
  return {
    ...draft,
    id: null,
    title: `${draft.title} ${titleSuffix}`.slice(0, 200),
    // A copy starts unpublished and unspent, whatever the original was doing.
    status: 'draft',
    completions: 0,
    attempts: 0,
    questionsLocked: false,
    questions: draft.questions.map((q) => ({ ...q })),
  }
}
