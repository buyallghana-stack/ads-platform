'use client'

import { useState } from 'react'

import { ArrowRight, Flag, MessageSquare, ShieldCheck, ShieldOff } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import type { Person } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import { DetailPanel, Fact, PanelFacts, PanelFooter, PanelSection } from './DetailPanel'
import { PERSON_RULES, personActions, type PersonAction } from './person-actions'
import type { PeopleMode } from './PeopleGrid'

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
}: {
  person: Person | null
  mode: PeopleMode
  now: number
  onClose: () => void
  onDecide: (id: string, action: PersonAction, reason: string) => void
}) {
  if (!person) return null
  /* Keyed, so opening a different account mounts a fresh panel rather than
     carrying a half-typed disable reason across to the wrong person. */
  return <Panel key={person.id} person={person} mode={mode} now={now} onClose={onClose} onDecide={onDecide} />
}

function Panel({
  person: p,
  mode,
  now,
  onClose,
  onDecide,
}: {
  person: Person
  mode: PeopleMode
  now: number
  onClose: () => void
  onDecide: (id: string, action: PersonAction, reason: string) => void
}) {
  const t = useTranslations('admin.people')
  const format = useFormatter()

  const [pending, setPending] = useState<PersonAction | null>(null)
  const [reason, setReason] = useState('')

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
      <PersonCell name={p.name} secondary={p.email} avatarUrl={p.avatarUrl} size="md" />

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

      <PanelSection label={t('panel.balance')}>
        <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">
          {p.balancePoints.toLocaleString()}
          <span className="ml-1.5 text-[0.875rem] font-medium text-ink-400">
            {t('panel.points')}
          </span>
        </p>
        <p className="mt-1.5 text-[0.75rem] text-ink-500">
          {t('panel.plan', { tier: p.tier })}
        </p>
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

      <PanelSection label={t('panel.contact')}>
        <PanelFacts>
          <Fact label={t('panel.email')} value={p.email} />
          <Fact label={t('panel.phone')} value={p.phone ?? '—'} />
        </PanelFacts>
      </PanelSection>

      {/* Messages leads with the thread, and says plainly that replying is
          not wired yet rather than rendering an invented transcript. An
          operator reading fake messages from a real user is worse than an
          empty panel. */}
      {mode === 'messages' && (
        <PanelSection label={t('panel.conversation')}>
          {p.lastMessage ? (
            <blockquote className="border-l-2 border-ink-300 pl-3 text-[0.8125rem] leading-relaxed text-ink-600">
              {p.lastMessage}
              {p.lastMessageAt && (
                <footer className="mt-1 text-[0.6875rem] text-ink-400">
                  {format.relativeTime(new Date(p.lastMessageAt), now)}
                </footer>
              )}
            </blockquote>
          ) : (
            <p className="text-[0.8125rem] text-ink-400">{t('noMessages')}</p>
          )}
          <p className="mt-3 rounded-(--radius-input) border border-dashed border-ink-200 px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-500">
            {t('chatSoonBody')}
          </p>
        </PanelSection>
      )}
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
            className="mt-1 w-full resize-none rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
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
