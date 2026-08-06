import type { Metadata } from 'next'

import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { LessonEditor } from '@/components/admin/LessonEditor'
import { Link, redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { getLessonDetail } from '@/lib/admin/catalogue-data'

export const metadata: Metadata = {
  title: 'Lesson',
  robots: { index: false, follow: false },
}

/**
 * One lesson, with its answer key.
 *
 * `getSessionUser`, not `getViewerUser`: this read returns `isCorrect` on every
 * option, so it must answer for the person actually signed in. A super admin
 * looking at somebody's account has no business seeing an editor at all, and
 * `admin_lesson_detail` calls `assert_admin` on the id passed to it anyway.
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; productId: string; lessonId: string }>
}) {
  const { locale, productId, lessonId } = await params
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const detail = await getLessonDetail(user!.id, lessonId)
  if (!detail.ok || !detail.lesson) notFound()

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5">
        <Link
          href={`/admin/catalogue/${productId}/curriculum`}
          className="text-[0.75rem] font-medium text-ink-500 hover:text-ink-800"
        >
          ← {detail.lesson.sectionTitle}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {detail.lesson.title}
        </h1>
      </header>
      <LessonEditor detail={detail} />
    </div>
  )
}
