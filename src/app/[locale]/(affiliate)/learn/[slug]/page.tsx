import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { Award, ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AffiliateHeader } from '@/components/affiliate/AffiliateHeader'
import { CurriculumList } from '@/components/affiliate/CurriculumList'
import { LessonView } from '@/components/affiliate/LessonView'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { courseProgress, getCurriculum, getLesson } from '@/lib/market/course'
import { getShopProduct } from '@/lib/market/data'
import { getNotifications, getUnreadCount } from '@/lib/notifications/data'
import { serverNow } from '@/lib/server-now'

export const metadata: Metadata = {
  title: 'Course',
  robots: { index: false, follow: false },
}

/**
 * A course: the player at the top, the curriculum beneath it.
 *
 * ── ONE ROUTE, NOT TWO ──
 *
 * The lesson is chosen with `?lesson=<id>` rather than by a nested route. That
 * is the reference's own layout (IMG_0582: video, tabs, then the lecture list
 * on the same screen) and it is also the right shape for the job — moving
 * between lessons keeps the curriculum in place instead of unmounting and
 * rebuilding it, and the URL still names exactly which lesson is open, so it
 * can be linked, shared and reloaded.
 *
 * ── WHICH LESSON OPENS BY DEFAULT ──
 *
 * The first one that is not finished, not the first one in the list. Somebody
 * returning to a half-finished course wants to carry on, and making them scroll
 * past nine ticks to find where they were is the difference between a course
 * that gets finished and one that does not — which here decides whether the
 * account ever starts earning.
 */
export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ lesson?: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.course')

  const [detail, notifications, unreadCount] = await Promise.all([
    getShopProduct(slug, user!.id),
    getNotifications(30),
    getUnreadCount(),
  ])
  if (!detail.ok) notFound()
  const { product } = detail

  const sections = await getCurriculum(product.id, user!.id)
  const { done, total } = courseProgress(sections)
  const lessons = sections.flatMap((s) => s.lessons)

  const asked = (await searchParams).lesson
  /* Validated against the curriculum rather than trusted. A hand-typed id from
     another course would otherwise reach `lesson_for_learner`, which refuses it
     correctly — but the page around it would still claim to be this course. */
  const chosen =
    lessons.find((l) => l.lesson_id === asked) ??
    lessons.find((l) => !l.completed) ??
    lessons[0]

  const payload = chosen ? await getLesson(user!.id, chosen.lesson_id) : null

  return (
    <div className="relative isolate mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />
      <AffiliateHeader notifications={notifications} unreadCount={unreadCount} now={serverNow()} />

      <Link
        href="/learn"
        className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <div>
        <h1 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.5rem]">
          {product.title}
        </h1>

        {/* Progress as a count AND a bar. The count is the honest unit — a
            course is finished in lessons, not in percent — and the bar is what
            the eye reads without stopping. */}
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${total ? (done / total) * 100 : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-[0.75rem] tabular-nums text-ink-500">
            {t('progress', { done, total })}
          </span>
        </div>

        {done === total && total > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-600">
            <Award aria-hidden className="size-4" />
            {t('finished')}
          </p>
        )}
      </div>

      {total === 0 ? (
        <p className="rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-10 text-center text-[0.8125rem] text-ink-500">
          {t('emptyCourse')}
        </p>
      ) : (
        /* Player above the list on a phone; side by side from xl, where there is
           room for the curriculum to stay visible while a lesson plays. */
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem] xl:items-start">
          <div className="min-w-0">
            {payload && <LessonView payload={payload} slug={slug} />}
          </div>

          <div className="xl:sticky xl:top-6">
            <CurriculumList
              sections={sections}
              slug={slug}
              currentLessonId={chosen?.lesson_id ?? null}
              entitled={product.owned}
            />
          </div>
        </div>
      )}
    </div>
  )
}
