import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { TasksBoard } from '@/components/admin/TasksBoard'
import { getAdminTasks } from '@/lib/admin/data/tasks'

export const metadata: Metadata = {
  title: 'Admin · Tasks',
  robots: { index: false, follow: false },
}

/**
 * Tasks: the milestones users complete for points.
 *
 * A task is a metric, a target and a reward, so creating one is choosing from
 * a list and typing two numbers — no code, which is what the operator asked
 * for. The screen's job beyond that is to show what a task will COST before
 * it is saved, because tasks are retroactive.
 */
export default async function AdminTasksPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.tasks')

  const tasks = await getAdminTasks()

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TasksBoard tasks={tasks} />
    </>
  )
}
