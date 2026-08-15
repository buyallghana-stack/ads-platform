'use client'

import { useState } from 'react'

import { CalendarCheck, Target } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { TasksView } from '@/components/tasks/TasksView'
import { WeeklyBonusView } from '@/components/weekly-bonus/WeeklyBonusView'
import { cn } from '@/lib/cn'
import type { UserTask } from '@/lib/tasks/types'
import type { WeeklyBonusStatus } from '@/lib/weekly-bonus/types'

const TABS = ['tasks', 'bonus'] as const
type Tab = (typeof TABS)[number]

export function TasksAndBonusView({
  tasks,
  bonusStatus,
}: {
  tasks: UserTask[]
  bonusStatus: WeeklyBonusStatus
}) {
  const tTasks = useTranslations('tasks')
  const tBonus = useTranslations('weeklyBonus')
  const [tab, setTab] = useState<Tab>('tasks')

  const claimableTasks = tasks.filter((t) => t.claimable).length
  const canClaimBonus = bonusStatus.enrolled && bonusStatus.canClaim

  return (
    <div className="mx-auto w-full max-w-2xl px-1 pb-10 pt-2">
      {/* Page Header matching SidePerks pattern */}
      <header className="animate-rise text-center">
        <h1 className="text-[1.5rem] font-bold tracking-[-0.02em] text-ink-900">
          {tab === 'tasks' ? tTasks('title') : tBonus('title')}
        </h1>
        <p className="mt-1 text-[0.875rem] text-ink-500">
          {tab === 'tasks' ? tTasks('subtitle') : tBonus('subtitle')}
        </p>
      </header>

      {/* Segmented toggle matching the Ads / Team page pattern */}
      <div
        role="tablist"
        aria-label={tTasks('tabs.label')}
        style={{ '--rise-delay': '0.04s' } as React.CSSProperties}
        className="animate-rise mt-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1"
      >
        {TABS.map((key) => {
          const selected = key === tab
          const Icon = key === 'tasks' ? Target : CalendarCheck
          const badgeCount = key === 'tasks' ? claimableTasks : canClaimBonus ? 1 : 0

          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-input)-0.25rem)]',
                'px-2 py-2.5 text-[0.8125rem] font-semibold transition-colors',
                'sm:gap-2 sm:px-3 sm:text-[0.875rem]',
                selected
                  ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                  : 'text-ink-500 hover:text-ink-700',
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  'hidden size-4 shrink-0 sm:block',
                  selected ? 'text-brand-600' : 'text-ink-400',
                )}
              />
              <span className="truncate">
                {key === 'tasks' ? tTasks('tabs.tasks') : tTasks('tabs.bonus')}
              </span>
              {badgeCount > 0 && (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-600 text-[0.6875rem] font-bold text-white">
                  {badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Panels */}
      <div role="tabpanel" className="mt-4">
        {tab === 'tasks' ? (
          <TasksView tasks={tasks} />
        ) : (
          <WeeklyBonusView status={bonusStatus} />
        )}
      </div>
    </div>
  )
}
