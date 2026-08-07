'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * The strip under the player: Lectures, Resources, About.
 *
 * ── WHY THE TAB IS LOCAL STATE AND NOT IN THE URL ──
 *
 * Everything else on this screen is addressable — the lesson is `?lesson=<id>`
 * so it can be linked and reloaded. The tab is deliberately not, because the
 * player sits ABOVE this strip and a navigation re-renders the tree that holds
 * it. Tapping Resources to check a worksheet name would stop the video and lose
 * the playhead, which is a strange punishment for looking at the second tab.
 * A tab is a view of the same page, not a different page.
 *
 * ── THE PANELS ARE SERVER-RENDERED AND PASSED IN ──
 *
 * All three arrive as props. The curriculum, the resource list and the course
 * facts are all reads that belong on the server, and passing them as elements
 * keeps them there: this component owns which one is visible and nothing else.
 * It never learns what a lesson or a resource is.
 *
 * ── HIDDEN, NOT UNMOUNTED ──
 *
 * The inactive panels stay in the tree with `hidden`, so returning to Lectures
 * lands on the same scroll position in a list that can be forty rows long,
 * rather than at the top of a freshly built one.
 */

const TABS = ['lectures', 'resources', 'about'] as const
type Tab = (typeof TABS)[number]

export function CourseTabs({
  lectures,
  resources,
  about,
  resourceCount,
}: {
  lectures: React.ReactNode
  resources: React.ReactNode
  about: React.ReactNode
  resourceCount: number
}) {
  const t = useTranslations('affiliate.course.tabs')
  const [tab, setTab] = useState<Tab>('lectures')

  return (
    <div className="min-w-0">
      {/* One hairline runs the width of the strip and the active tab draws a
          thicker bar over it, so the underline reads as a position on a track
          rather than as an underlined word. */}
      <div role="tablist" className="flex items-stretch gap-1 border-b border-ink-200">
        {TABS.map((name) => {
          const active = tab === name
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`course-panel-${name}`}
              onClick={() => setTab(name)}
              className={cn(
                'relative -mb-px shrink-0 px-3 pb-2.5 pt-1 text-[0.9375rem] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                active ? 'font-semibold text-ink-900' : 'font-medium text-ink-500 hover:text-ink-800',
              )}
            >
              <span className="flex items-center gap-1.5">
                {t(name)}
                {/* The count earns its place on Resources only: it answers
                    "is there anything in there" without a tap, and on a course
                    with no attachments it says so by being absent. */}
                {name === 'resources' && resourceCount > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-[0.6875rem] font-semibold tabular-nums',
                      active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600',
                    )}
                  >
                    {resourceCount}
                  </span>
                )}
              </span>

              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-600"
                />
              )}
            </button>
          )
        })}
      </div>

      {TABS.map((name) => (
        <div
          key={name}
          id={`course-panel-${name}`}
          role="tabpanel"
          hidden={tab !== name}
          className="pt-4"
        >
          {name === 'lectures' ? lectures : name === 'resources' ? resources : about}
        </div>
      ))}
    </div>
  )
}
