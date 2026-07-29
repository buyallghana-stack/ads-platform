'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { decidePerson } from '@/app/[locale]/admin/users/actions'
import {
  loadSupportThread,
  replyToSupport,
  setSupportStatus,
} from '@/app/[locale]/admin/messages/actions'
import type { AdminSupportThread } from '@/lib/admin/data/support'
import type { Person } from '@/lib/admin/types'

import { PeopleGrid, type PeopleMode } from './PeopleGrid'
import { PersonPanel } from './PersonPanel'
import type { PersonAction } from './person-actions'

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
 * what comes back is the refreshed list, never a locally predicted status.
 *
 * No optimistic paint, for the same reason the payout queue has none: a card
 * that reads "disabled" for the half-second before the database disagrees is
 * a card an operator can act on or walk away from. Here it also keeps the two
 * screens honest about each other — clearing a flag on Flagged removes the
 * account from the list, because that is what clearing it meant, and painting
 * it "active" in place would leave it sitting on a screen it no longer
 * belongs to.
 *
 * MESSAGES IS LIVE TOO AS OF 2026-07-29 and was the last preview screen in
 * the admin area. Opening somebody there loads their transcript — lazily, on
 * open, because a hundred conversations attached to a list nobody has clicked
 * is a hundred transcripts sent for nothing.
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
  const t = useTranslations('admin.people')

  const [rows, setRows] = useState(people)
  const [openId, setOpenId] = useState<string | null>(null)

  /* What the database said when it refused. Shown verbatim — it raises these
     in operator language ("A reason is required to disable an account"), and
     rewording them here would mean a second vocabulary for the same rules. */
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  /* The open conversation on Messages. Null on the other two screens, and
     null again the moment a different person is opened, so a transcript can
     never be shown under somebody else's name. */
  const [thread, setThread] = useState<AdminSupportThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadBusy, startThreadWork] = useTransition()

  const openPerson = (person: Person) => {
    setOpenId(person.id)
    if (mode !== 'messages') return

    setThread(null)
    setThreadLoading(true)
    startThreadWork(async () => {
      const result = await loadSupportThread(person.id)
      setThreadLoading(false)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setThread(result.thread)
      // Reading it cleared the unread count, so the card has changed too.
      if (result.people) setRows(result.people)
    })
  }

  const applyThreadResult = (result: Awaited<ReturnType<typeof replyToSupport>>) => {
    if (result.ok) {
      setThread(result.thread)
      if (result.people) setRows(result.people)
      return
    }
    setError(result.message)
  }

  const reply = (body: string) => {
    if (!openId) return
    setError(null)
    startThreadWork(async () => applyThreadResult(await replyToSupport({ userId: openId, body })))
  }

  const toggleStatus = (closed: boolean) => {
    if (!openId) return
    setError(null)
    startThreadWork(async () => applyThreadResult(await setSupportStatus(openId, closed)))
  }

  const decide = (id: string, action: PersonAction, reason: string) => {
    setError(null)

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
        onOpen={openPerson}
        onDecide={decide}
      />
      <PersonPanel
        person={open}
        mode={mode}
        now={serverNow}
        onClose={() => {
          setOpenId(null)
          setThread(null)
        }}
        onDecide={decide}
        thread={thread}
        threadLoading={threadLoading}
        threadBusy={threadBusy}
        onReply={reply}
        onToggleStatus={toggleStatus}
      />
    </>
  )
}
