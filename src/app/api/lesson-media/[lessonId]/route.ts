import { NextResponse } from 'next/server'

import { getViewerUser } from '@/lib/auth/session'
import { signedLessonUrl } from '@/lib/content/access'

/**
 * A short-lived signed URL for one lesson's media.
 *
 * ── WHY A ROUTE AND NOT A PROP ON THE PAGE ──
 *
 * The link expires in minutes and a server-rendered page can sit in an open tab
 * for hours. Embedding the URL in the HTML means a player that works on first
 * paint and 403s on the first seek after lunch — which reads as a broken video,
 * not as an expired link. Fetching it when the player mounts means it is always
 * fresh.
 *
 * ── THE AUTHORISATION IS IN `signedLessonUrl`, NOT HERE ──
 *
 * It checks the entitlement against the PRODUCT the lesson belongs to, and
 * allows a preview lesson through without one. Repeating that check here would
 * be two places to keep in step; this route's only job is to say who is asking.
 *
 * `no-store`, because a CDN caching a signed URL would hand one user's link to
 * the next one — and the link is the only thing standing between the open
 * internet and paid content.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const { lessonId } = await params

  /* The VIEWED user, so a super admin's read-only look can play the video they
     are looking at. This is a read; the write side (`markLessonProgress`)
     refuses while a look is open. */
  const user = await getViewerUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const access = await signedLessonUrl(user.id, lessonId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === 'not-entitled' ? 403 : 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { url: access.url, expiresInSeconds: access.expiresInSeconds },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
