'use client'

import { useState } from 'react'

import type { Person } from '@/lib/admin/types'

import { PeopleGrid, type PeopleMode } from './PeopleGrid'
import { PersonPanel } from './PersonPanel'
import { PERSON_RULES, type PersonAction } from './person-actions'

/**
 * Holds the account list and the selection for Users, Flagged and Messages.
 *
 * Split from PeopleGrid so the grid stays a presentational list and the three
 * pages share one behaviour: pick somebody, their review panel opens over the
 * list. It used to be that only Messages opened anything at all — the two
 * screens an operator actually investigates on could be read but not acted
 * on. Now all three open the same panel.
 *
 * Decisions are local state only, as everywhere else in this preview. When
 * the backend lands, `decide` becomes a server action and nothing else here
 * changes.
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
  const [rows, setRows] = useState(people)
  const [openId, setOpenId] = useState<string | null>(null)

  const decide = (id: string, action: PersonAction, reason: string) => {
    const rule = PERSON_RULES[action]
    setRows((all) =>
      all.map((p) =>
        p.id === id
          ? {
              ...p,
              status: rule.next,
              /* Clearing a flag clears the note with it. Leaving last month's
                 reason on a now-active account is how a resolved case gets
                 re-opened by the next person who reads it. */
              flaggedBy: rule.next === 'active' ? undefined : 'admin',
              flagReason: rule.next === 'active' ? undefined : reason || p.flagReason,
            }
          : p,
      ),
    )
  }

  const open = rows.find((p) => p.id === openId) ?? null

  return (
    <>
      <PeopleGrid
        people={rows}
        mode={mode}
        serverNow={serverNow}
        openId={openId}
        onOpen={(p) => setOpenId(p.id)}
        onDecide={decide}
      />
      <PersonPanel
        person={open}
        mode={mode}
        now={serverNow}
        onClose={() => setOpenId(null)}
        onDecide={decide}
      />
    </>
  )
}
