'use client'

import { useState } from 'react'
import { Gift, Target } from 'lucide-react'
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
  const t = useTranslations('tasks')
  const [tab, setTab] = useState<Tab>('tasks')

  return (
    <div className="mx-auto w-full max-w-2xl px-1 pb-10 pt-2">
      {/* Segmented toggle matching the Ads page pattern */}
      <div
        role="tablist"
        aria-label={t('tabs.label')}
        className="animate-rise mb-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1"
      >
        {TABS.map((key) => {
          const selected = key === tab
          const Icon = key === 'tasks' ? Target : Gift
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
                className={cn('hidden size-4 shrink-0 sm:block', selected ? 'text-brand-600' : 'text-ink-400')}
              />
              <span className="truncate">{t(`tabs.${key}`)}</span>
            </button>
          )
        })}
      </div>

      {/* Tab panels */}
      <div role="tabpanel">
        {tab === 'tasks' ? (
          <TasksView tasks={tasks} />
        ) : (
          <WeeklyBonusView status={bonusStatus} />
        )}
      </div>
    </div>
  )
}
