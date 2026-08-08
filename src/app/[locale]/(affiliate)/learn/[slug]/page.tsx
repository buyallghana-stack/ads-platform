import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { Award, ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CourseAbout } from '@/components/affiliate/CourseAbout'
import { CourseResources } from '@/components/affiliate/CourseResources'
import { CourseTabs } from '@/components/affiliate/CourseTabs'
import { CurriculumList } from '@/components/affiliate/CurriculumList'
import { LessonView } from '@/components/affiliate/LessonView'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import {
  courseProgress,
  getCourseResources,
  getCurriculum,
  getLesson,
  neighbours,
} from '@/lib/market/course'
import { coverUrl } from '@/lib/market/covers'
import { getShopProduct } from '@/lib/market/data'

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

  const [detail] = await Promise.all([
    getShopProduct(slug, user!.id),
  ])
  if (!detail.ok) notFound()
  const { product, training } = detail

  const sections = await getCurriculum(product.id, user!.id)
  const { done, total } = courseProgress(sections)
  const lessons = sections.flatMap((s) => s.lessons)

  const asked = (await searchParams).lesson
  /* Validated against the curriculum rather than trusted. A hand-typed id from
     another course would otherwise reach `lesson_for_learner`, which refuses it
     correctly — but the page around it would still claim to be this course. */
  /*
    ⚠️ A NON-OWNER OPENS THE PREVIEW, NOT LESSON ONE. The fallback used to be
    "first unfinished, else the first" — which for somebody who has not bought
    the course is a LOCKED lesson, so arriving from the product page's Free
    preview badge would have shown "You do not own this lesson". The one thing
    they were promised is the one thing they must land on.
  */
  const chosen =
    lessons.find((l) => l.lesson_id === asked) ??
    (product.owned
      ? (lessons.find((l) => !l.completed) ?? lessons[0])
      : (lessons.find((l) => l.is_preview) ?? lessons[0]))

  /*
    ⚠️ THE OPEN LESSON IS PINNED IN THE URL, AND THAT IS A CORRECTNESS FIX.

    The fallback above is a QUERY — "the first unfinished lesson" — so its
    answer changes the moment anything completes. While that answer was only
    computed on a fresh visit, that was fine. It stopped being fine when
    articles began marking themselves on arrival: any refresh of this page
    re-ran the query, landed on the next unfinished article, mounted it, marked
    it, and refreshed again. One visit walked the entire course and issued a
    certificate for it.

    Redirecting once, on arrival, turns the query into a fact. After this the
    URL always names the lesson, so no later render can choose a different one
    — and the docblock above, which already claimed the URL names exactly which
    lesson is open, becomes true.

    It cannot loop: the redirect only happens when `asked` did not match, and
    what it redirects to matches by construction.
  */
  if (chosen && asked !== chosen.lesson_id) {
    redirect({ href: `/learn/${slug}?lesson=${chosen.lesson_id}`, locale })
  }

  const payload = chosen ? await getLesson(user!.id, chosen.lesson_id) : null
  const { previous, next } = neighbours(sections, chosen?.lesson_id ?? null)

  const resources = await getCourseResources(product.id, user!.id)

  return (
    <div className="relative isolate mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

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
        /* ⚠️ `grid-cols-1` and `minmax(0,1fr)`, not a bare `grid` and `1fr`.

           An implicitly-sized grid column is `auto`, which means it is sized to
           its content's MIN-CONTENT — and `1fr` is shorthand for
           `minmax(auto, 1fr)`, which has the same floor. Either way the column
           grows to whatever its widest child needs and the page scrolls
           sideways; at 390px this one settled at 480px, which showed up not as
           a scrollbar but as the dark canvas stopping three-quarters of the way
           across, because a background paints its own box and not the
           document's.

           `minmax(0, …)` is what lets the column be narrower than its content
           so the children's own truncation and wrapping can do their job.
           Caught by `scripts/verify-affiliate-ui.mjs`. */
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className="min-w-0">
            {payload && (
              <LessonView
                payload={payload}
                slug={slug}
                previous={previous}
                next={next}
                poster={coverUrl(product.coverPath)}
                /* Null once they own it: the locked state is then
                   unreachable, and an offer to buy what you already have is
                   the worst thing a course page can say. */
                offer={
                  product.owned
                    ? null
                    : {
                        productId: product.id,
                        title: product.title,
                        priceMinor: product.priceMinor,
                        listPriceMinor: product.listPriceMinor,
                        onSale: product.onSale,
                        lessons: product.lessons,
                        certificate: training?.certificate ?? false,
                      }
                }
              />
            )}
          </div>

          {/* The strip sits beside the player from xl and under it on a phone,
              which is the reference's own arrangement at phone width. */}
          <div className="xl:sticky xl:top-6">
            <CourseTabs
              resourceCount={resources.length}
              lectures={
                <CurriculumList
                  sections={sections}
                  slug={slug}
                  currentLessonId={chosen?.lesson_id ?? null}
                  entitled={product.owned}
                />
              }
              resources={<CourseResources resources={resources} />}
              about={
                <CourseAbout
                  description={product.description}
                  outcomes={product.outcomes}
                  lessons={product.lessons}
                  quizzes={product.quizzes}
                  seconds={product.seconds}
                  training={training}
                />
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
