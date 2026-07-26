'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { adDraftPayload, validateAd, type AdErrors } from '@/lib/admin/ad-draft'
import { getAdDraft } from '@/lib/admin/ads-data'
import type { AdDraft, AdStatus } from '@/lib/admin/types'
import { getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'

/**
 * Writes for the ad pool.
 *
 * All three go through the SERVICE client because admin_save_ad,
 * admin_set_ad_status and admin_delete_ad are revoked from `authenticated`.
 * That is not a bypass: each one takes the acting admin's id and verifies the
 * role itself (assert_admin), and the id comes from the verified session here,
 * never from the payload. A browser token cannot reach the ad pool at all.
 *
 * The draft is re-validated on this side with the same pure function the form
 * uses. The client's opinion of its own validity is not evidence.
 */

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

const optionSchema = z.object({
  key: z.string(),
  text: z.string(),
  correct: z.boolean(),
})

const ruleSchema = z.object({
  key: z.string(),
  dependsOn: z.string(),
  optionKey: z.string().nullable(),
  valueText: z.string().nullable(),
  negate: z.boolean(),
})

const questionSchema = z.object({
  key: z.string(),
  text: z.string(),
  format: z.enum(['multiple_choice', 'short_text']),
  correctAnswer: z.string().nullable(),
  showAtSeconds: z.number().int().nullable(),
  conditionMode: z.enum(['all', 'any']),
  options: z.array(optionSchema).max(20),
  rules: z.array(ruleSchema).max(10),
})

const draftSchema = z.object({
  id: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  advertiser: z.string(),
  format: z.enum(['video', 'survey']),
  status: z.enum(['draft', 'active', 'paused', 'exhausted', 'archived']),
  points: z.number().int(),
  videoSource: z.enum(['upload', 'youtube']).nullable(),
  storagePath: z.string().nullable(),
  youtubeId: z.string().nullable(),
  thumbnailPath: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  minWatchSeconds: z.number().int().nullable(),
  maxCompletions: z.number().int().nullable(),
  weight: z.number().int(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  tierIds: z.array(z.uuid()).max(20),
  questions: z.array(questionSchema).max(40),
  completions: z.number().int(),
  attempts: z.number().int(),
  questionsLocked: z.boolean(),
})

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type SaveAdResult =
  | { ok: true; id: string }
  /** Field-level problems, keyed exactly as validateAd keys them. */
  | { ok: false; errors: AdErrors }
  /** Something the database refused. Its message is written for a human and
   *  is shown verbatim — these come from our own RAISE statements. */
  | { ok: false; message: string }

export type ActionResult = { ok: true } | { ok: false; message: string }

export type DeleteAdResult =
  | { ok: true; outcome: 'deleted' | 'archived' }
  | { ok: false; message: string }

const UNAUTHORISED = 'You are not signed in as an administrator.'
const GENERIC = 'That could not be saved. Please try again.'

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/**
 * One ad in full, for the review panel.
 *
 * Fetched when a panel opens rather than shipped with every row: this is the
 * privileged read — it carries the answer key — and it only matters for the
 * ad actually being looked at. getAdDraft names the acting admin from the
 * session and the database verifies the role.
 */
export async function loadAdDraft(adId: string): Promise<AdDraft | null> {
  return getAdDraft(adId)
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

export async function saveAd(input: AdDraft): Promise<SaveAdResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const parsed = draftSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: GENERIC }
  const draft = parsed.data as AdDraft

  const errors = validateAd(draft)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const admin = createAdminClient()

  // What the ad currently points at, so a replaced upload does not sit in the
  // bucket forever. Read before the write, used after it.
  const previous = draft.id
    ? (
        await admin
          .from('ads')
          .select('storage_path, thumbnail_path')
          .eq('id', draft.id)
          .maybeSingle()
      ).data
    : null

  const payload = adDraftPayload(draft)

  const { data, error } = await admin.rpc('admin_save_ad', {
    p_admin_id: user.id,
    // The generated `Json` type cannot describe "an object of these fields";
    // the shape that matters is the one admin_save_ad reads, and it is
    // asserted by adDraftPayload right above.
    p_ad: payload.ad as Json,
    p_questions: payload.questions as Json,
    p_tier_ids: payload.tierIds ?? undefined,
  })

  if (error) return { ok: false, message: humanise(error.message) }

  const id = data as unknown as string

  await removeOrphans(previous, draft)

  revalidatePath('/admin/ads')
  return { ok: true, id }
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export async function setAdStatus(adId: string, status: AdStatus): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_set_ad_status', {
    p_admin_id: user.id,
    p_ad_id: adId,
    p_status: status,
  })

  if (error) return { ok: false, message: humanise(error.message) }

  revalidatePath('/admin/ads')
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Delete or archive                                                   */
/* ------------------------------------------------------------------ */

/**
 * The database decides which of the two this is: an outright delete while
 * nobody has attempted the ad, an archive once somebody has. The caller is
 * told what actually happened rather than being left to assume.
 */
export async function deleteAd(adId: string): Promise<DeleteAdResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: UNAUTHORISED }

  const admin = createAdminClient()

  const { data: media } = await admin
    .from('ads')
    .select('storage_path, thumbnail_path')
    .eq('id', adId)
    .maybeSingle()

  const { data, error } = await admin.rpc('admin_delete_ad', {
    p_admin_id: user.id,
    p_ad_id: adId,
  })

  if (error) return { ok: false, message: humanise(error.message) }

  const outcome = (data as unknown as string) === 'deleted' ? 'deleted' : 'archived'

  // Only a real delete frees the files. An archived ad keeps its media,
  // because the record has to stay explicable.
  if (outcome === 'deleted') {
    await removeMedia([media?.storage_path, media?.thumbnail_path])
  }

  revalidatePath('/admin/ads')
  return { ok: true, outcome }
}

/* ------------------------------------------------------------------ */

/**
 * Objects the ad no longer points at.
 *
 * Uses the service client, which is not subject to the bucket policies — the
 * authenticated storage API resolves an object through SELECT before deleting
 * it, and a missing read policy makes remove() report success while deleting
 * nothing. That bug is already in this repo's history once.
 */
async function removeOrphans(
  previous: { storage_path: string | null; thumbnail_path: string | null } | null,
  draft: AdDraft,
) {
  if (!previous) return

  const gone: (string | null | undefined)[] = []
  if (previous.storage_path && previous.storage_path !== draft.storagePath) {
    gone.push(previous.storage_path)
  }
  if (previous.thumbnail_path && previous.thumbnail_path !== draft.thumbnailPath) {
    gone.push(previous.thumbnail_path)
  }

  await removeMedia(gone)
}

async function removeMedia(paths: (string | null | undefined)[]) {
  // Seeded media is shared between the seeded ads by design, so deleting one
  // of them would break the others. Anything under seed/ stays.
  const real = paths.filter((p): p is string => Boolean(p) && !p!.startsWith('seed/'))
  if (real.length === 0) return

  const admin = createAdminClient()
  await admin.storage.from('ad-media').remove(real)
}

/**
 * Database messages worth showing.
 *
 * Our own RAISE statements are written for an operator ("This ad has already
 * delivered its whole budget…"), so they are passed straight through. A
 * constraint name or a Postgres error code is not, and gets a generic line —
 * the form has already said what is wrong about the fields it knows.
 */
function humanise(message: string): string {
  const clean = message.trim()
  if (!clean || /violates|constraint|syntax error|null value|invalid input/i.test(clean)) {
    return GENERIC
  }
  return clean
}
