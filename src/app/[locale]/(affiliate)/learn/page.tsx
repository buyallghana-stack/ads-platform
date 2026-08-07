import type { Metadata } from 'next'

import { Award, Download, GraduationCap } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { coverUrl } from '@/lib/market/covers'
import { getMyLearning } from '@/lib/market/data'

export const metadata: Metadata = {
  title: 'Learn',
  robots: { index: false, follow: false },
}

/**
 * Everything the account is entitled to, and everything it has finished.
 *
 * ── TWO SECTIONS, IN THIS ORDER, ALWAYS ──
 *
 * In progress first, certificates second — even when there are more of the
 * second than the first. The reference puts achievements at the top, which is
 * the right call for a platform whose users come back to admire what they have
 * done. Ours come back to finish something: the course is the gate on their
 * ability to earn, so the thing with work left in it is the thing that belongs
 * where the thumb lands.
 *
 * A certificate row shows its GRADE when one was recorded. Older certificates
 * have none — `grade_percent` is nullable because certificates existed before
 * the column did — and a null renders as no grade rather than as zero, which
 * would be a different and much worse claim.
 */
export default async function LearnPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.learn')
  const format = await getFormatter()

  const [{ certificates, ongoing }] = await Promise.all([
    getMyLearning(user!.id),
  ])

  const empty = ongoing.length === 0 && certificates.length === 0

  return (
    <div className="relative isolate mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <div
        aria-hidden
        className="bg-field pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
      />

      <div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[1.625rem]">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      {empty && (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface px-6 py-14 text-center">
          <span
            aria-hidden
            className="mx-auto grid size-12 place-items-center rounded-full bg-ink-100 text-ink-400"
          >
            <GraduationCap className="size-6" />
          </span>
          <p className="mt-3 text-[0.875rem] font-medium text-ink-900">{t('emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-500">
            {t('emptyBody')}
          </p>
          <Link
            href="/market"
            className="mt-4 inline-flex rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
          >
            {t('emptyCta')}
          </Link>
        </div>
      )}

      {ongoing.length > 0 && (
        <section>
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('inProgress')}</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {ongoing.map((course) => {
              const cover = coverUrl(course.coverPath)
              const started = course.percent > 0
              return (
                <li key={course.productId}>
                  <Link
                    href={`/learn/${course.slug}`}
                    className="flex gap-3.5 rounded-(--radius-panel) border border-ink-200 bg-surface p-3 transition-colors hover:border-ink-300 sm:p-4"
                  >
                    <span className="aspect-square w-20 shrink-0 overflow-hidden rounded-(--radius-card) bg-ink-100 sm:w-24">
                      {cover ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <span aria-hidden className="grid size-full place-items-center text-ink-400">
                          <GraduationCap className="size-6" />
                        </span>
                      )}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col justify-center">
                      <span className="truncate text-[0.9375rem] font-semibold text-ink-900">
                        {course.title}
                      </span>
                      {course.instructor && (
                        <span className="mt-0.5 truncate text-[0.75rem] text-ink-500">
                          {course.instructor}
                        </span>
                      )}

                      {/* "8 lessons left" rather than only a percentage. A
                          percentage says how far you have come; a count says
                          how much is in the way, which is what decides whether
                          somebody opens it now. */}
                      <span className="mt-2 flex items-center justify-between gap-3 text-[0.75rem]">
                        <span className="text-ink-500">
                          {course.lessonsLeft > 0
                            ? t('lessonsLeft', { n: course.lessonsLeft })
                            : t('allDone')}
                        </span>
                        <span className="font-semibold tabular-nums text-ink-900">
                          {course.percent}%
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <span
                          className="block h-full rounded-full bg-brand-600"
                          style={{ width: `${Math.min(Math.max(course.percent, 0), 100)}%` }}
                        />
                      </span>
                      <span className="mt-2 text-[0.75rem] font-semibold text-brand-700">
                        {started ? t('continue') : t('start')}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {certificates.length > 0 && (
        <section>
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('certificates')}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="flex gap-3 rounded-(--radius-panel) border border-success-500/25 bg-success-50 p-4"
              >
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-success-500/15 text-success-600"
                >
                  <Award className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-semibold text-ink-900">
                    {certificate.title}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-ink-600">
                    {t('issued', {
                      date: format.dateTime(new Date(certificate.issuedAt), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }),
                    })}
                  </p>
                  {/* Null means no grade was recorded, not a grade of zero. */}
                  {certificate.grade !== null && (
                    <p className="mt-1 text-[0.75rem] font-semibold tabular-nums text-success-700">
                      {t('grade', { n: certificate.grade })}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-[0.6875rem] text-ink-500">{certificate.code}</p>

                  {/* ⚠️ WITHOUT THIS THE CERTIFICATE IS UNREACHABLE. The page
                      that renders and downloads it lives at
                      /market/certificate/[productId] and nothing linked to it,
                      so the whole feature existed and no user could get to it. */}
                  <Link
                    href={`/market/certificate/${certificate.productId}`}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-(--radius-input) bg-success-600 px-3 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-success-700"
                  >
                    <Download aria-hidden className="size-4" />
                    {t('view')}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
