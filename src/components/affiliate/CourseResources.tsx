import { FileText, Paperclip } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import type { CourseResource } from '@/lib/market/course'

/**
 * Everything attached to the course, grouped by the lesson it belongs to.
 *
 * ── THIS IS THE HONEST VERSION OF "DOWNLOADS" ──
 *
 * The reference puts a download arrow on every row and a Downloads tab beside
 * Lectures. We do not hand the files over: a downloaded copy of a paid course
 * is a copy that outlives the entitlement that paid for it, and the affiliate
 * training is the thing standing between an account and the ability to earn
 * real money. So the tab answers the question somebody actually opens it with
 * — "where was that worksheet" — and the answer is a lesson to tap, not a file
 * to keep.
 *
 * Grouped by lesson rather than listed flat, because a resource's name means
 * little on its own; "Checklist" is three different documents on a course with
 * three sections, and the lesson is what tells them apart.
 */
export async function CourseResources({ resources }: { resources: CourseResource[] }) {
  const t = await getTranslations('affiliate.course')

  if (resources.length === 0) {
    return (
      <p className="rounded-(--radius-panel) border border-ink-200 bg-surface px-5 py-10 text-center text-[0.8125rem] text-ink-500">
        {t('noResources')}
      </p>
    )
  }

  /* Grouped in one pass and in arrival order, which is already curriculum
     order from the RPC. Sorting again here would be a second opinion about
     what order a course is in. */
  const groups: { lessonId: string; lessonTitle: string; items: CourseResource[] }[] = []
  for (const resource of resources) {
    const last = groups.at(-1)
    if (last?.lessonId === resource.lesson_id) last.items.push(resource)
    else
      groups.push({
        lessonId: resource.lesson_id,
        lessonTitle: resource.lesson_title,
        items: [resource],
      })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-[0.8125rem] leading-snug text-ink-500">
        <Paperclip aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-400" />
        <span>{t('resourcesNote')}</span>
      </p>

      {groups.map((group) => (
        <section key={group.lessonId}>
          <h3 className="truncate text-[0.8125rem] font-semibold text-ink-500">
            {group.lessonTitle}
          </h3>

          <ul className="mt-2 overflow-hidden rounded-(--radius-card) border border-ink-200">
            {group.items.map((item) => (
              <li
                key={item.resource_id}
                className="flex items-center gap-2.5 border-b border-ink-200 bg-surface px-3.5 py-3 last:border-b-0"
              >
                <FileText aria-hidden className="size-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink-800">
                  {item.title}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
