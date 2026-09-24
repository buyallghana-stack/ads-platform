'use client'

import { useState } from 'react'

import { ArrowRight, Eye, Flag, MessageSquare, ShieldCheck, ShieldOff } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import type { Person } from '@/lib/admin/types'
import type { TeamMilestones } from '@/lib/tasks/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'
import { PERSON_RULES, personActions, type PersonAction } from './person-actions'
import type { PeopleMode } from './PeopleGrid'
import { SupportConversation } from './SupportConversation'
import type { AdminSupportThread } from '@/lib/admin/data/support'
import { viewAsUser } from '@/app/[locale]/admin/(super)/users/actions'

/**
 * One account, everything about it, and the decision at the bottom.
 *
 * There used to be no such thing: selecting a person on Users or Flagged did
 * nothing, and only Messages opened a pane. That left the two screens an
 * operator actually investigates on — who is this, and why was this flagged —
 * as lists you could look at but not act on.
 *
 * Deliberately ONE panel for all three tabs rather than three. A person is
 * the same person whether you reached them from the user list, a fraud flag
 * or a message, so the facts and the actions are the same; what changes is
 * which section leads. Three panels would drift, and an operator would have
 * to learn three ways to disable the same account.
 *
 * THE NUMBERS ARE HERE FOR ONE REASON. A balance on its own cannot tell you
 * whether an account is a person or a farm. 91,500 points earned across seven
 * months is a good customer; the same 91,500 in nine days, on a device shared
 * with five other accounts, is the thing the flag was raised about. So the
 * panel always shows lifetime against join date and ads watched — the ratio,
 * not just the total.
 */

export function PersonPanel({
  person,
  mode,
  now,
  onClose,
  onDecide,
  milestones = null,
  thread = null,
  threadLoading = false,
  threadBusy = false,
  onReply,
  onToggleStatus,
}: {
  person: Person | null
  mode: PeopleMode
  now: number
  onClose: () => void
  onDecide: (id: string, action: PersonAction, reason: string) => void
  /** The team milestone ladder; null while loading or for staff who may
   *  not read it, and then the section is simply absent. */
  milestones?: TeamMilestones | null
  /** Messages only: the open conversation and its handlers. Null everywhere
   *  else, which is what keeps this panel one component across three screens. */
  thread?: AdminSupportThread | null
  threadLoading?: boolean
  threadBusy?: boolean
  /* Required, not optional with a fallback. These were defaulted to `() => {}`,
     which meant a caller that forgot them got a Send button that swallowed
     every reply in silence — the same shape as the password reset form that
     sat broken in production. A missing handler is a wiring mistake and the
     compiler should be the one to say so. */
  onReply: (body: string) => void
  onToggleStatus: (closed: boolean) => void
}) {
  if (!person) return null
  /* Keyed, so opening a different account mounts a fresh panel rather than
     carrying a half-typed disable reason across to the wrong person. */
  return (
    <Panel
      key={person.id}
      person={person}
      mode={mode}
      now={now}
      onClose={onClose}
      onDecide={onDecide}
      milestones={milestones}
      thread={thread}
      threadLoading={threadLoading}
      threadBusy={threadBusy}
      onReply={onReply}
      onToggleStatus={onToggleStatus}
    />
  )
}

function Panel({
  person: p,
  mode,
  now,
  onClose,
  onDecide,
  milestones,
  thread,
  threadLoading,
  threadBusy,
  onReply,
  onToggleStatus,
}: {
  person: Person
  mode: PeopleMode
  now: number
  onClose: () => void
  onDecide: (id: string, action: PersonAction, reason: string) => void
  milestones: TeamMilestones | null
  thread: AdminSupportThread | null
  threadLoading: boolean
  threadBusy: boolean
  onReply: (body: string) => void
  onToggleStatus: (closed: boolean) => void
}) {
  const t = useTranslations('admin.people')
  const format = useFormatter()

  const [pending, setPending] = useState<PersonAction | null>(null)
  const [reason, setReason] = useState('')
  /* Latched until the page navigates away, so a second tap cannot open a
     second look — the database ends the first one, and the two redirects
     would race. */
  const [viewing, setViewing] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

  const actions = personActions(p)
  const requestClose = () => (pending ? setPending(null) : onClose())

  const start = (action: PersonAction) => {
    const rule = PERSON_RULES[action]
    if (rule.confirm || rule.reason) {
      setPending(action)
      setReason('')
    } else {
      onDecide(p.id, action, '')
    }
  }

  const submit = () => {
    if (!pending) return
    onDecide(p.id, pending, reason.trim())
    setPending(null)
    setReason('')
  }

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  const tone = p.status === 'disabled' ? 'danger' : p.status === 'flagged' ? 'warning' : 'success'

  /* Points per day since joining. The single most useful number on this
     screen, and one nobody would work out by hand while triaging. */
  const daysHere = Math.max(1, Math.round((now - new Date(p.joinedAt).getTime()) / 86_400_000))
  const perDay = Math.round(p.lifetimePoints / daysHere)

  return (
    <DetailPanel
      title={t('panel.title', { name: p.name })}
      closeLabel={t('panel.close')}
      onClose={requestClose}
      header={
        <div className="flex items-center gap-2.5">
          <StatusDot tone={tone}>{t(`status.${p.status}`)}</StatusDot>
          {(p.unread ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] text-ink-400">
              <MessageSquare aria-hidden className="size-3" />
              {t('panel.unread', { count: p.unread ?? 0 })}
            </span>
          )}
        </div>
      }
      footer={
        actions.length > 0 && (
          <PanelFooter raised={Boolean(pending)}>
            {pending ? (
              <ConfirmStep
                action={pending}
                person={p}
                reason={reason}
                setReason={setReason}
                onCancel={() => setPending(null)}
                onConfirm={submit}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {actions.map((a, i) => (
                  <Button
                    key={a}
                    type="button"
                    size="md"
                    variant={
                      PERSON_RULES[a].destructive ? 'ghost' : i === 0 ? 'primary' : 'secondary'
                    }
                    onClick={() => start(a)}
                    className={cn(
                      i === 0 && 'flex-1',
                      PERSON_RULES[a].destructive && 'text-danger-700 hover:bg-danger-50',
                    )}
                  >
                    <ActionIcon action={a} />
                    {t(`actions.${a}`)}
                  </Button>
                ))}
              </div>
            )}
          </PanelFooter>
        )
      }
    >
      <PersonCell name={p.name} secondary={p.email} size="md" />

      {/* The flag leads when that is what the operator came for. */}
      {p.status !== 'active' && p.flagReason && (
        <div
          className={cn(
            'mt-4 rounded-(--radius-card) border p-3.5',
            p.status === 'disabled'
              ? 'border-danger-500/25 bg-danger-50'
              : 'border-warning-500/30 bg-warning-50',
          )}
        >
          <p
            className={cn(
              'text-[0.6875rem] font-semibold tracking-[0.04em] uppercase',
              p.status === 'disabled' ? 'text-danger-700' : 'text-warning-600',
            )}
          >
            {t(`flaggedBy.${p.flaggedBy ?? 'system'}`)}
          </p>
          <p
            className={cn(
              'mt-1 text-[0.8125rem] leading-relaxed',
              p.status === 'disabled' ? 'text-danger-700/90' : 'text-warning-600/90',
            )}
          >
            {p.flagReason}
          </p>
        </div>
      )}

      {/* Messages LEADS with the conversation: the reply is the work, and the
         account facts below it are the context an operator reads while
         writing one. It sat last until testing showed the composer clipped
         under the panel's sticky footer, which made replying a scroll hunt
         past six sections. */}
      {mode === 'messages' && (
        <PanelSection label={t('panel.conversation')}>
          <SupportConversation
            thread={thread}
            loading={threadLoading}
            busy={threadBusy}
            onReply={onReply}
            onToggleStatus={onToggleStatus}
          />
        </PanelSection>
      )}

      <PanelSection label={t('panel.balance')}>
        <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">
          {p.balancePoints.toLocaleString()}
          <span className="ml-1.5 text-[0.875rem] font-medium text-ink-400">
            {t('panel.points')}
          </span>
        </p>
        {/* The plan's NAME is no longer the whole answer. Since plans became
            bands, two people on Gold can earn at different rates because they
            paid different amounts inside it — so the rate they actually earn
            at, and what they are paying for it, sit right here. It is the
            first thing support is asked about ("why does my friend earn more
            than me on the same plan") and it was only answerable in SQL. */}
        <p className="mt-1.5 text-[0.75rem] text-ink-500">
          {p.tierPaidGhs > 0
            ? t('panel.planPaid', {
                tier: p.tier,
                /* Pesewas shown when there are any. The amount is the thing
                   that sets the rate now, so rounding GHS 102.50 to "103"
                   hides the very number this line exists to report. */
                ghs: p.tierPaidGhs.toLocaleString(undefined, {
                  minimumFractionDigits: Number.isInteger(p.tierPaidGhs) ? 0 : 2,
                  maximumFractionDigits: 2,
                }),
                rate: p.tierMultiplier,
              })
            : t('panel.plan', { tier: p.tier })}
        </p>

        {/* Looking at what THEY see, rather than inferring it from this panel.
            Read-only: the whole app refuses writes while a look is open, so
            this is a window, not a way in. It sits here rather than in the
            footer because the footer is for decisions ABOUT the account —
            flag, disable — and this changes nothing. */}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3 w-full"
          disabled={viewing}
          onClick={async () => {
            setViewing(true)
            const result = await viewAsUser(p.id)
            if (!result.ok) {
              setViewing(false)
              setViewError(result.message ?? null)
              return
            }
            // A full document load: the viewing cookie has to be on the
            // request that renders the dashboard, and a client transition
            // would reuse the router cache from before it was set.
            window.location.assign('/dashboard')
          }}
        >
          <Eye aria-hidden className="size-3.5" />
          {t('panel.viewAs')}
        </Button>
        {viewError && (
          <p className="mt-1.5 text-[0.75rem] text-danger-700">{viewError}</p>
        )}
      </PanelSection>

      <PanelSection label={t('panel.activity')}>
        <PanelFacts>
          <Fact label={t('panel.joined')} value={date(p.joinedAt)} />
          <Fact
            label={t('panel.lastActive')}
            value={format.relativeTime(new Date(p.lastActiveAt), now)}
          />
          <Fact
            label={t('panel.lifetime')}
            value={t('panel.lifetimeValue', {
              points: p.lifetimePoints.toLocaleString(),
              perDay: perDay.toLocaleString(),
            })}
          />
          <Fact label={t('panel.adsWatched')} value={p.adsWatched.toLocaleString()} />
          <Fact label={t('panel.referrals')} value={p.referrals.toLocaleString()} />
          <Fact label={t('panel.paidOut')} value={`GHS ${p.paidOutGhs.toLocaleString()}`} />
        </PanelFacts>
      </PanelSection>

      {milestones && milestones.rungs.length > 0 && (
        <MilestonesSection data={milestones} date={date} />
      )}

      <PanelSection label={t('panel.contact')}>
        <PanelFacts>
          <Fact label={t('panel.email')} value={p.email} />
          <Fact label={t('panel.phone')} value={p.phone ?? '—'} />
        </PanelFacts>
      </PanelSection>

    </DetailPanel>
  )
}

/* ------------------------------------------------------------------ */

function ActionIcon({ action }: { action: PersonAction }) {
  const cls = 'size-4'
  if (action === 'flag') return <Flag aria-hidden className={cls} />
  if (action === 'disable') return <ShieldOff aria-hidden className={cls} />
  return <ShieldCheck aria-hidden className={cls} />
}

function ConfirmStep({
  action,
  person,
  reason,
  setReason,
  onCancel,
  onConfirm,
}: {
  action: PersonAction
  person: Person
  reason: string
  setReason: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('admin.people')
  const rule = PERSON_RULES[action]
  const ready = !rule.reason || reason.trim().length >= 3

  return (
    <div>
      <p className="text-[0.8125rem] leading-relaxed font-medium text-ink-900">
        {t(`confirm.${action}`, {
          name: person.name,
          points: person.balancePoints.toLocaleString(),
        })}
      </p>

      {rule.reason && (
        <label className="mt-3 block">
          <span className="text-[0.6875rem] font-medium text-ink-500">
            {t('confirm.reasonLabel')}
          </span>
          <textarea
            autoFocus
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(`confirm.reasonPlaceholder.${action}`)}
            className="mt-1 w-full resize-none rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
          />
          <span className="mt-1 block text-[0.625rem] text-ink-400">{t('confirm.reasonHint')}</span>
        </label>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="button" size="md" variant="secondary" onClick={onCancel} className="flex-1">
          {t('confirm.cancel')}
        </Button>
        <Button
          type="button"
          size="md"
          variant={rule.destructive ? 'danger' : 'primary'}
          disabled={!ready}
          onClick={onConfirm}
          className="flex-1"
        >
          {t(`actions.${action}`)}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Team milestones for one account: where they stand and every payout.
 *
 * "Highest reached" comes from the payouts, not the live count, because the
 * count follows ACTIVE plans and can fall below a rung that was already paid.
 * A reached rung the member has not claimed yet is shown as waiting: it is
 * money owed, and support is asked about it.
 */
function MilestonesSection({
  data,
  date,
}: {
  data: TeamMilestones
  date: (iso: string) => string
}) {
  const t = useTranslations('admin.people.panel.milestones')
  const ghs = (points: number) =>
    `GHS ${(points / data.pointsPerUnit).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  const highest = data.history.reduce((top, row) => Math.max(top, row.target), 0)

  return (
    <PanelSection label={t('title')}>
      <PanelFacts>
        <Fact label={t('teamSize')} value={data.teamMembers.toLocaleString()} />
        <Fact
          label={t('current')}
          value={data.current ? t('members', { count: data.current.target }) : t('none')}
        />
        <Fact label={t('highest')} value={highest > 0 ? t('members', { count: highest }) : t('none')} />
        <Fact label={t('total')} value={ghs(data.paidPoints)} />
        <Fact
          label={t('next')}
          value={
            data.next
              ? t('nextValue', { count: data.next.target, needed: data.next.needed, payout: ghs(data.next.payoutPoints) })
              : t('none')
          }
        />
        {data.claimablePoints > 0 && (
          <Fact label={t('waiting')} value={ghs(data.claimablePoints)} />
        )}
      </PanelFacts>

      {data.history.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-(--radius-input) border border-ink-200">
          {data.history.map((row) => (
            <li key={`${row.target}-${row.claimedAt}`} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-medium text-ink-900">
                  {t('members', { count: row.target })}
                </p>
                <p className="text-[0.6875rem] text-ink-500">
                  {t('historyLine', {
                    date: date(row.claimedAt),
                    from: ghs(row.previousTotalPoints),
                    to: ghs(row.milestoneTotalPoints),
                    atClaim: row.membersAtClaim,
                  })}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[0.8125rem] font-semibold tabular-nums text-success-700">
                  +{ghs(row.paidPoints)}
                </p>
                <p className="text-[0.6875rem] text-ink-400">{t('paid')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}
