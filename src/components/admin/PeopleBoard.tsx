'use client'

import { useState } from 'react'

import type { Person } from '@/lib/admin/types'

import { ConversationPanel, PeopleGrid, type PeopleMode } from './PeopleGrid'

/**
 * Holds the selection state for the stacked people layout.
 *
 * Split from PeopleGrid so the grid stays a presentational list and the three
 * pages (Users, Flagged, Messages) share one behaviour: pick somebody, a
 * panel opens beside them on a wide screen and over them on a narrow one.
 *
 * On Messages that panel is the conversation. On the other two it is not
 * rendered yet — the person detail view is its own screen and its own piece
 * of work, so selecting there is a no-op rather than a half-built drawer.
 */
export function PeopleBoard({
  people,
  mode,
  serverNow,
}: {
  people: Person[]
  mode: PeopleMode
  serverNow: number
}) {
  const [selected, setSelected] = useState<Person | null>(null)
  const showPanel = mode === 'messages' && selected !== null

  return (
    <div className={showPanel ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined}>
      <div className="min-w-0">
        <PeopleGrid
          people={people}
          mode={mode}
          serverNow={serverNow}
          onOpen={mode === 'messages' ? setSelected : undefined}
        />
      </div>

      {showPanel && selected && (
        <>
          {/* Beside the list from xl, where there is room for both. */}
          <div className="hidden xl:block">
            <ConversationPanel person={selected} serverNow={serverNow} onClose={() => setSelected(null)} />
          </div>

          {/* Over it below xl — a 22rem rail beside a one-column grid on a
              tablet would leave neither usable. */}
          <div className="fixed inset-0 z-40 flex items-end bg-ink-900/40 p-3 xl:hidden">
            <div className="max-h-[80dvh] w-full overflow-y-auto">
              <ConversationPanel person={selected} serverNow={serverNow} onClose={() => setSelected(null)} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
