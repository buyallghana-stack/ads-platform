import { GraduationCap } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { MarketHeader } from '@/components/market/MarketHeader'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getAffiliateDashboard } from '@/lib/market/data'

/**
 * The courses this account owns.
 *
 * Reuses the dashboard read rather than adding a second one: it already
 * returns every entitled course with its completion percentage, and a
 * separate query would be a second definition of "which courses are mine".
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

  const t = await getTranslations('market.learn')
  const data = await getAffiliateDashboard(user!.id)
  const courses = data.training ?? []

  return (
    <div className="market-skin min-h-full bg-canvas">
      <MarketHeader title={t('title')} />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-7">
        {courses.length === 0 ? (
          <div className="rounded-(--radius-card) border border-dashed border-ink-300 bg-surface px-4 py-10 text-center">
            <GraduationCap aria-hidden className="mx-auto size-6 text-ink-400" />
            <p className="mt-3 text-sm font-semibold text-ink-900">{t('empty.title')}</p>
            <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-snug text-ink-600">
              {t('empty.body')}
            </p>
            <Link
              href="/market"
              className="mt-4 inline-flex rounded-(--radius-input) bg-jade-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-jade-700"
            >
              {t('empty.cta')}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => (
              <li key={course.product_id}>
                <Link
                  href={`/learn/${course.slug}`}
                  className="flex h-full flex-col rounded-(--radius-card) border border-ink-200 bg-surface p-4 transition-colors hover:border-ink-300"
                >
                  <p className="text-sm font-semibold text-ink-900">{course.title}</p>
                  <p className="mt-1 text-[0.8125rem] text-ink-600">
                    {course.percent >= 100 ? t('complete') : t('percentDone', { n: course.percent })}
                  </p>
                  <div
                    role="progressbar"
                    aria-valuenow={course.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={course.title}
                    className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100"
                  >
                    <div
                      className="h-full rounded-full bg-jade-600"
                      style={{ width: `${Math.min(100, course.percent)}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
