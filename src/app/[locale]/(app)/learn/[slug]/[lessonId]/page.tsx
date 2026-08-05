import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { LessonView } from '@/components/market/LessonView'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { signedLessonUrl } from '@/lib/content/access'
import { getCurriculum, getLesson } from '@/lib/market/course'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * One lesson.
 *
 * The media URL is signed HERE, per request, rather than baked into anything
 * cached: the links live 15 minutes, and a URL rendered into a cached page
 * would either be expired on arrival or — worse — still valid long after the
 * page was shared.
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; lessonId: string }>
}) {
  const { locale, slug, lessonId } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const payload = await getLesson(user!.id, lessonId)
  if (!payload.ok) {
    // `locked` sends them to the sales page rather than a 404: they are
    // looking at something real that they do not own yet, and the useful
    // response to that is the offer, not a dead end.
    if (payload.reason === 'locked') redirect({ href: `/shop/${slug}`, locale })
    notFound()
  }

  const [sections, media] = await Promise.all([
    getCurriculum(payload.lesson.product_id, user!.id),
    payload.lesson.kind === 'video'
      ? signedLessonUrl(user!.id, lessonId)
      : Promise.resolve(null),
  ])

  /* Entitlement for the curriculum's lock state, and the course title for the
     rail header. Both cheap, and in parallel because this page already makes
     the caller wait on a signed URL.

     Entitlement must NOT be inferred from "this lesson opened" — a preview
     opens without one, and inferring it would unlock the whole curriculum for
     anybody who followed a preview link. */
  const admin = createAdminClient()
  const [{ data: entitled }, { data: product }] = await Promise.all([
    admin.rpc('has_entitlement', {
      p_user_id: user!.id,
      p_product_id: payload.lesson.product_id,
    }),
    admin.from('products').select('title').eq('id', payload.lesson.product_id).maybeSingle(),
  ])

  return (
    <LessonView
      lesson={payload.lesson}
      sections={sections}
      quizzes={payload.quizzes}
      progress={payload.progress}
      resources={payload.resources}
      mediaUrl={media?.ok ? media.url : null}
      slug={slug}
      entitled={Boolean(entitled)}
      courseTitle={product?.title ?? ''}
    />
  )
}
