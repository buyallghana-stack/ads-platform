import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LearnScreen } from '@/components/market/LearnScreen'
import { redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { getMyLearning } from '@/lib/market/data'

/**
 * The Learn tab — what you have finished, and what you are part-way through.
 *
 * No page header. The reference opens straight into "Recent Certifications",
 * and a title bar saying "My courses" above a section saying "Ongoing Courses"
 * is the same word twice before any content.
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
  const { certificates, ongoing } = await getMyLearning(user!.id)

  return (
    <div className="market-skin min-h-full bg-canvas">
      <LearnScreen
        certificates={certificates}
        ongoing={ongoing}
        labels={{
          title: t('title'),
          certifications: t('certifications'),
          viewAll: t('viewAll'),
          ongoing: t('ongoing'),
          continueLabel: t('continue'),
          lessonsLeft: (n: number) => t('lessonsLeft', { n }),
          completed: (date: string) => t('completed', { date }),
          emptyTitle: t('empty.title'),
          emptyBody: t('empty.body'),
          emptyCta: t('empty.cta'),
        }}
      />
    </div>
  )
}
