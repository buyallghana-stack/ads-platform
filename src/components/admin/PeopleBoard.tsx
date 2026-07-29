'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { decidePerson } from '@/app/[locale]/admin/users/actions'
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
 * DECISIONS ARE REAL AS OF 2026-07-29, on Users and Flagged. `decide` calls
 * the server action, which calls the function that owns the transition, and
 * what comes back is the refreshed list — NOT `PERSON_RULES[action].next`.
 *
 * No optimistic paint, for the same reason the payout queue has none: a card
 * that reads "disabled" for the half-second before the database disagrees is
 * a card an operator can act on or walk away from. Here it also keeps the two
 * screens honest about each other — clearing a flag on Flagged removes the
 * account from the list, because that is what clearing it meant, and painting
 * it "active" in place would leave it sitting on a screen it no longer
 * belongs to.
 *
 * MESSAGES IS STILL PREVIEW (`live={false}`) and decides in local state, as
 * every screen here used to. There is no message backend — the support chat
 * is waiting on the operator's chatbot — so that tab renders invented people
 * behind the preview badge, and must not be allowed to send their ids to a
 * function that would go looking for them.
 */
export function PeopleBoard({
  people,
  mode,
  serverNow,
  live,
}: {
  people: Person[]
  mode: PeopleMode
  serverNow: number
  /** True where the list came from the database and decisions must go back
   *  to it. Explicit rather than derived from `mode`, so wiring Messages up
   *  later is one prop rather than a rule somebody has to notice. */
  live: boolean
}) {
  const t = useTranslations('admin.people')

  const [rows, setRows] = useState(people)
  const [openId, setOpenId] = useState<string | null>(null)

  /* What the database said when it refused. Shown verbatim — it raises these
     in operator language ("A reason is required to disable an account"), and
     rewording them here would mean a second vocabulary for the same rules. */
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const decide = (id: string, action: PersonAction, reason: string) => {
    setError(null)

    if (!live) {
      const rule = PERSON_RULES[action]
      setRows((all) =>
        all.map((p) =>
          p.id === id
            ? {
                ...p,
                status: rule.next,
                /* Clearing a flag clears the note with it. Leaving last
                   month's reason on a now-active account is how a resolved
                   case gets re-opened by the next person who reads it. */
                flaggedBy: rule.next === 'active' ? undefined : 'admin',
                flagReason: rule.next === 'active' ? undefined : reason || p.flagReason,
              }
            : p,
        ),
      )
      setOpenId(null)
      return
    }

    startTransition(async () => {
      const result = await decidePerson({
        id,
        action,
        reason,
        scope: mode === 'flagged' ? 'flagged' : 'all',
      })

      // A refused change still returns the list as it now stands, so an
      // account somebody else has already handled corrects itself on screen
      // instead of staying stale under the error.
      if (result.people) setRows(result.people)
      if (!result.ok) {
        setError(result.message)
        return
      }

      setOpenId(null)
    })
  }

  const open = rows.find((p) => p.id === openId) ?? null

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-3"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-700" />
          <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-danger-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 text-danger-700/70 hover:text-danger-700"
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">{t('errors.dismiss')}</span>
          </button>
        </div>
      )}

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
