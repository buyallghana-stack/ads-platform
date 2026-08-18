import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { TasksView } from '@/components/tasks/TasksView'
import { getViewerUser } from '@/lib/auth/session'
import { getTasks } from '@/lib/tasks/data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tasks' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Tasks — milestones a user completes for points.
 *
 * Rendered per request. Progress is derived from history on every load rather
 * than stored, so it cannot go stale and a task created this morning is
 * already complete for somebody who did the thing last month.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) return null

  const tasks = await getTasks()

  return <TasksView tasks={tasks} />
}
