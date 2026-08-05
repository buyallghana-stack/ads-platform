import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Handing out course content, one short-lived URL at a time.
 *
 * THE WHOLE CONTENT-PROTECTION DECISION LIVES OR DIES HERE. Streaming was
 * rescinded (E35), DRM was declined (E30), and what is left is: a private
 * bucket, a URL that expires in minutes, and an entitlement checked on the
 * server before either is issued. If this module is bypassed, none of the rest
 * of it means anything.
 *
 * ⚠️ THE MISTAKE THIS EXISTS TO PREVENT is copying Phase 1. Ad video lives in
 * `ad-media`, which is PUBLIC — correct for an advert, since the point is to
 * be seen. A public bucket URL is permanent and unauthenticated: paid course
 * video behind one is not "downloadable if somebody tries", it is published on
 * the open internet. `course-media` is private and has no storage policy at
 * all, so this is the only route in.
 *
 * A determined viewer can still capture what they are watching. That is
 * accepted and was decided (E30) — the goal is to stop casual sharing and make
 * a leak traceable, which is what the per-user watermark is for.
 */

/**
 * How long a link lives.
 *
 * Short enough that a URL pasted into a group chat is dead before anybody
 * opens it, long enough that a lesson does not die mid-sentence on a slow
 * connection. The player re-signs as playback continues rather than holding
 * one link for the whole video.
 */
const LINK_SECONDS = 15 * 60

const BUCKET = 'course-media'

export type ContentAccess =
  | { ok: true; url: string; expiresInSeconds: number }
  | { ok: false; reason: 'not-found' | 'not-entitled' | 'no-file' }

/**
 * A playable URL for a lesson, or a refusal.
 *
 * The entitlement is checked against the lesson's PRODUCT, not against the
 * lesson — a learner owns a course, not a row. A preview lesson skips the
 * check entirely, which is what makes the store's "watch the first one free"
 * possible without a second code path.
 */
export async function signedLessonUrl(
  userId: string,
  lessonId: string,
): Promise<ContentAccess> {
  const admin = createAdminClient()

  const { data: lesson } = await admin
    .from('lessons')
    .select('id, storage_path, is_preview, kind, course_sections!inner(product_id)')
    .eq('id', lessonId)
    .maybeSingle()

  if (!lesson) return { ok: false, reason: 'not-found' }
  if (!lesson.storage_path) return { ok: false, reason: 'no-file' }

  if (!lesson.is_preview) {
    const productId = (lesson.course_sections as unknown as { product_id: string }).product_id
    const { data: entitled } = await admin.rpc('has_entitlement', {
      p_user_id: userId,
      p_product_id: productId,
    })
    if (!entitled) return { ok: false, reason: 'not-entitled' }
  }

  return sign(lesson.storage_path)
}

/**
 * The same for a downloadable-looking resource, which is deliberately not
 * downloadable.
 *
 * The reference screenshots put a download arrow on every row; the content
 * decisions say read-in-app only, so a resource is fetched through this and
 * rendered rather than handed over. There is no preview concept here — a PDF
 * attached to a lesson belongs to whoever owns the course.
 */
export async function signedResourceUrl(
  userId: string,
  resourceId: string,
): Promise<ContentAccess> {
  const admin = createAdminClient()

  const { data: resource } = await admin
    .from('lesson_resources')
    .select('id, storage_path, lessons!inner(course_sections!inner(product_id))')
    .eq('id', resourceId)
    .maybeSingle()

  if (!resource) return { ok: false, reason: 'not-found' }

  const productId = (
    resource.lessons as unknown as { course_sections: { product_id: string } }
  ).course_sections.product_id

  const { data: entitled } = await admin.rpc('has_entitlement', {
    p_user_id: userId,
    p_product_id: productId,
  })
  if (!entitled) return { ok: false, reason: 'not-entitled' }

  return sign(resource.storage_path)
}

async function sign(path: string): Promise<ContentAccess> {
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrl(path, LINK_SECONDS)

  /* A failure here is reported as "no file" rather than thrown. The caller is
     a player asking for the next segment of a lesson somebody paid for; a
     stack trace helps nobody, and the refusal is the same shape as every other
     one it already handles. */
  if (error || !data?.signedUrl) return { ok: false, reason: 'no-file' }

  return { ok: true, url: data.signedUrl, expiresInSeconds: LINK_SECONDS }
}
