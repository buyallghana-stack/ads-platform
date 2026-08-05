import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getCurriculum } from '@/lib/market/course'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * A course, opened by slug.
 *
 * This page renders nothing of its own — it works out where the learner
 * should be and sends them there. A course landing page separate from the
 * player would be a screen whose only content is a list the player already
 * shows, and one more tap between somebody and the thing they came back for.
 *
 * "Where they should be" is the first lesson they have not finished, falling
 * back to the first lesson overall once the course is complete.
 */
export default async function CoursePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const admin = createAdminClient()
  const { data: product } = await admin
    .from('products')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (!product) notFound()

  const sections = await getCurriculum(product.id, user!.id)
  const lessons = sections.flatMap((s) => s.lessons)
  if (lessons.length === 0) notFound()

  const next = lessons.find((l) => !l.completed) ?? lessons[0]
  redirect({ href: `/learn/${slug}/${next.lesson_id}`, locale })
}
