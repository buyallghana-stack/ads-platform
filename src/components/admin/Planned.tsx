import { Check, Circle } from 'lucide-react'

import { StatusPill } from './AdminChrome'
import { cn } from '@/lib/cn'

/**
 * A tab that exists, is navigable, and states exactly what it will hold.
 *
 * This is the pattern that worked for the Profile hub: rather than hiding
 * unbuilt screens, list them with their contents so the operator can point at
 * one and say "that next". A missing tab is a conversation nobody has; a tab
 * with its scope written down is a decision waiting to be made.
 *
 * Each item is marked with whether the BACKEND behind it already exists,
 * because that is what decides how long it takes. Most of this platform's
 * admin functions are already written and tested in the database with no
 * screen in front of them — saying so turns a wish-list into an estimate.
 */

export type PlannedItem = {
  title: string
  body: string
  /** The database function or table that already does this, if any. */
  backend?: string
}

export function Planned({ items }: { items: PlannedItem[] }) {
  return (
    <ul className="grid gap-2.5 md:grid-cols-2">
      {items.map((item) => (
        <li
          key={item.title}
          className="flex gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
        >
          <span
            aria-hidden
            className={cn(
              'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
              item.backend ? 'bg-success-50 text-success-600' : 'bg-ink-100 text-ink-400',
            )}
          >
            {item.backend ? <Check className="size-3" strokeWidth={3} /> : <Circle className="size-2 fill-current" />}
          </span>

          <div className="min-w-0">
            <p className="text-[0.8125rem] font-semibold text-ink-900">{item.title}</p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-ink-500">{item.body}</p>
            {item.backend && (
              <code className="mt-1.5 inline-block rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-600">
                {item.backend}
              </code>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Header note distinguishing "screen missing" from "nothing built at all". */
export function PlannedNote({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3">
      <StatusPill tone={ready ? 'success' : 'neutral'}>
        {ready ? 'Backend ready' : 'Not started'}
      </StatusPill>
      <p className="min-w-0 flex-1 text-[0.75rem] leading-relaxed text-ink-600">{children}</p>
    </div>
  )
}
