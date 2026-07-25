'use client'

import { useEffect, useRef, useState } from 'react'

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Gavel,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { REVEAL_SECONDS, maskDestination, nameMatches } from '@/lib/admin/destination'
import type { PayoutRequest } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import { ACTION_RULES, availableActions, type PayoutAction } from './payout-actions'
import { PAYOUT_TONE } from './payout-status'

/**
 * The payout review panel — one request, everything about it, and the
 * decision at the bottom.
 *
 * THE LAYOUT ARGUMENT
 * The row cannot answer "should I pay this?" and it should not try. It has
 * room for who, how much, where to, and how old — enough to triage, not
 * enough to judge. Everything that decides the answer (is this wallet shared
 * with other accounts, does the name match, is this account six days old,
 * has this person been paid before) lives here, in a panel that opens over
 * the queue without losing it.
 *
 * That split is also what rescues the buttons. Approve / Hold / Decline
 * crammed into a table cell is three tiny targets fighting the data for
 * attention; the same three at full size under the evidence that justifies
 * them is just a decision. Same actions, correct place.
 *
 * On a phone it is a bottom sheet instead of a side panel, because a 460px
 * drawer on a 390px screen is a modal pretending not to be one.
 */

export function PayoutDrawer({
  request,
  now,
  onClose,
  onDecide,
}: {
  request: PayoutRequest | null
  now: number
  onClose: () => void
  onDecide: (id: string, action: PayoutAction, reason: string) => void
}) {
  if (!request) return null
  /* Keyed on the request, so opening a different payout mounts a fresh panel
     rather than resetting five pieces of state in an effect. That is not a
     tidiness point: carrying a revealed account number or a half-typed
     decline reason across from the previous payout is how the wrong person
     gets declined. React guarantees the reset; an effect only promises it. */
  return <Panel key={request.id} request={request} now={now} onClose={onClose} onDecide={onDecide} />
}

function Panel({
  request: r,
  now,
  onClose,
  onDecide,
}: {
  request: PayoutRequest
  now: number
  onClose: () => void
  onDecide: (id: string, action: PayoutAction, reason: string) => void
}) {
  const t = useTranslations('admin.payouts')
  const ts = useTranslations('admin.overview.status')
  const format = useFormatter()

  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState<PayoutAction | null>(null)
  const [reason, setReason] = useState('')

  /* Re-mask on a timer. See REVEAL_SECONDS: the realistic exposure is a
     screen left unattended, not an attacker. */
  useEffect(() => {
    if (!revealed) return
    const id = setTimeout(() => setRevealed(false), REVEAL_SECONDS * 1000)
    return () => clearTimeout(id)
  }, [revealed])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  /* Escape closes; the confirmation step eats the first Escape so it cancels
     the decision rather than throwing away the whole panel underneath it.
     The scroll lock and the focus restore are torn down together because
     they are the same concern: the page is exactly as it was before. */
  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    /* Focus lands inside the panel, so a keyboard operator is not tabbing
       through the whole queue to reach the decision. */
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      restoreFocusTo.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pending) setPending(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, onClose])

  const actions = availableActions(r, now)
  const ghs = (n: number) =>
    `GHS ${format.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const masked = maskDestination(r)
  const nameOk = nameMatches(r.user.name, r.accountName)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.destination)
      setCopied(true)
    } catch {
      // Clipboard denied (insecure origin, or the user said no). Falling back
      // to a reveal is the honest answer — they can still read and type it.
      setRevealed(true)
    }
  }

  const submit = () => {
    if (!pending) return
    onDecide(r.id, pending, reason.trim())
    setPending(null)
    setReason('')
  }

  const start = (action: PayoutAction) => {
    const rule = ACTION_RULES[action]
    if (rule.confirm || rule.reason) {
      setPending(action)
      setReason('')
    } else {
      onDecide(r.id, action, '')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Scrim. Clicking it closes, but not while a decision is half-made —
          losing a typed decline reason to a stray click is a real loss. */}
      <button
        type="button"
        aria-label={t('drawer.close')}
        onClick={() => (pending ? setPending(null) : onClose())}
        className="absolute inset-0 bg-ink-900/40 animate-[scrim-in_150ms_ease-out] backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('drawer.title', { reference: r.reference })}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-full w-full flex-col bg-surface focus:outline-none',
          // Phone: a sheet off the bottom, capped so the queue stays visible.
          'mt-auto max-h-[92dvh] rounded-t-(--radius-panel) animate-[panel-in-bottom_220ms_cubic-bezier(0.22,1,0.36,1)]',
          // Tablet up: a full-height side panel.
          'sm:mt-0 sm:h-full sm:max-h-full sm:w-[27.5rem] sm:rounded-none sm:border-l sm:border-ink-200',
          'sm:animate-[panel-in-right_220ms_cubic-bezier(0.22,1,0.36,1)]',
        )}
      >
        {/* ---- Header ------------------------------------------------- */}
        <div className="flex shrink-0 items-start gap-3 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[0.8125rem] font-medium text-ink-900">
                {r.reference}
              </span>
              <StatusDot tone={PAYOUT_TONE[r.status]}>{ts(r.status)}</StatusDot>
            </div>
            <p className="mt-1 text-[0.75rem] text-ink-400">
              {t('drawer.requested', {
                when: format.relativeTime(new Date(r.requestedAt), now),
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('drawer.close')}
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-(--radius-input) text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {/* ---- Body --------------------------------------------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* Amount. The largest thing in the panel, because it is the number
              the decision is actually about. */}
          <p className="text-[2rem] leading-none font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">
            {ghs(r.ghs)}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-500 tabular-nums">
            {t('drawer.pointsRate', {
              points: r.points.toLocaleString(),
              rate: format.number(r.points / r.ghs, { maximumFractionDigits: 0 }),
            })}
          </p>

          {/* ---- Destination ----------------------------------------- */}
          <Section label={t('drawer.destination')}>
            <div className="rounded-(--radius-card) border border-ink-200 bg-ink-50/50 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.75rem] font-medium text-ink-600">{r.provider}</span>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={revealed ? t('drawer.hide') : t('drawer.reveal')}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? <EyeOff /> : <Eye />}
                  </IconButton>
                  <IconButton label={t('drawer.copy')} onClick={copy}>
                    {copied ? <Check className="text-success-600" /> : <Copy />}
                  </IconButton>
                </div>
              </div>

              <p
                className={cn(
                  'mt-2 font-mono text-[0.9375rem] break-all text-ink-900',
                  // The mask is wide-tracked so the dots read as redaction
                  // rather than as an ellipsis or a loading state.
                  !revealed && 'tracking-[0.08em]',
                )}
              >
                {revealed ? r.destination : masked}
              </p>

              <p className="mt-2 text-[0.6875rem] text-ink-400">
                {revealed ? t('drawer.revealNotice', { seconds: REVEAL_SECONDS }) : t('drawer.maskNotice')}
              </p>

              {/* Name on the account, against the name on the profile. The
                  cheapest check there is and the one people skip. */}
              <div className="mt-3 border-t border-ink-200 pt-3">
                <p className="text-[0.6875rem] text-ink-400">{t('drawer.accountName')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-medium text-ink-900">{r.accountName}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold',
                      nameOk
                        ? 'bg-success-50 text-success-700'
                        : 'bg-warning-50 text-warning-600',
                    )}
                  >
                    {nameOk ? <Check aria-hidden className="size-3" /> : <AlertTriangle aria-hidden className="size-3" />}
                    {nameOk ? t('drawer.nameMatch') : t('drawer.nameCheck')}
                  </span>
                </div>
              </div>
            </div>
          </Section>

          {/* ---- Who ------------------------------------------------- */}
          <Section label={t('drawer.requester')}>
            <PersonCell
              name={r.user.name}
              secondary={r.user.email}
              avatarUrl={r.user.avatarUrl}
              size="md"
            />
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact
                label={t('drawer.joined')}
                value={format.dateTime(new Date(r.user.joinedAt), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              />
              <Fact
                label={t('drawer.paidBefore')}
                value={
                  r.user.paidBefore === 0
                    ? t('drawer.firstPayout')
                    : t('drawer.paidBeforeValue', {
                        count: r.user.paidBefore,
                        total: ghs(r.user.paidBeforeGhs),
                      })
                }
              />
            </dl>
          </Section>

          {/* ---- Risk ------------------------------------------------- */}
          {(r.riskReasons?.length || r.reuse > 0 || r.risk !== 'low') && (
            <Section label={t('drawer.risk')}>
              <div
                className={cn(
                  'rounded-(--radius-card) border p-3.5',
                  r.risk === 'critical' || r.risk === 'high'
                    ? 'border-danger-500/25 bg-danger-50'
                    : 'border-warning-500/30 bg-warning-50',
                )}
              >
                <p
                  className={cn(
                    'flex items-center gap-1.5 text-[0.8125rem] font-semibold',
                    r.risk === 'critical' || r.risk === 'high'
                      ? 'text-danger-700'
                      : 'text-warning-600',
                  )}
                >
                  <ShieldAlert aria-hidden className="size-4 shrink-0" />
                  {t(`riskLevel.${r.risk}`)}
                </p>
                {r.riskReasons && r.riskReasons.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {r.riskReasons.map((reasonText) => (
                      <li
                        key={reasonText}
                        className={cn(
                          'flex gap-1.5 text-[0.75rem] leading-relaxed',
                          r.risk === 'critical' || r.risk === 'high'
                            ? 'text-danger-700/90'
                            : 'text-warning-600/90',
                        )}
                      >
                        <span aria-hidden>·</span>
                        {reasonText}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          )}

          {/* Only when the risk block has not already said it. A shared wallet
              stated twice in two different tones reads as two findings. */}
          {r.reuse > 0 && !r.riskReasons?.length && (
            <p className="mt-3 flex items-start gap-2 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2.5 text-[0.75rem] text-ink-600">
              <Users aria-hidden className="mt-px size-3.5 shrink-0 text-ink-400" />
              {t('drawer.reuse', { count: r.reuse })}
            </p>
          )}

          {/* What the last operator told the user. Shown here so a second
              operator picking up a held payout does not repeat the question
              the user has already been asked. */}
          {r.decisionNote && (
            <Section label={t('drawer.note')}>
              <blockquote className="border-l-2 border-ink-300 pl-3 text-[0.8125rem] leading-relaxed text-ink-600">
                {r.decisionNote}
              </blockquote>
            </Section>
          )}
        </div>

        {/* ---- Decision ------------------------------------------------ */}
        {actions.length > 0 && (
          <div
            className={cn(
              'shrink-0 border-t border-ink-200 bg-surface px-5 py-4',
              'pb-[max(1rem,env(safe-area-inset-bottom))]',
              // The confirmation step grows this bar over the content behind
              // it; the lift makes it read as a bar that rose rather than as
              // a second panel that appeared.
              pending && 'shadow-[0_-10px_24px_-14px_rgb(15_23_42/0.35)]',
            )}
          >
            {pending ? (
              <ConfirmStep
                action={pending}
                request={r}
                masked={masked}
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
                      ACTION_RULES[a].destructive ? 'ghost' : i === 0 ? 'primary' : 'secondary'
                    }
                    onClick={() => start(a)}
                    className={cn(
                      i === 0 && 'flex-1',
                      ACTION_RULES[a].destructive && 'text-danger-700 hover:bg-danger-50',
                    )}
                  >
                    <ActionIcon action={a} />
                    {t(`actions.${a}`)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ActionIcon({ action }: { action: PayoutAction }) {
  const cls = 'size-4'
  if (action === 'hold') return <Clock aria-hidden className={cls} />
  if (action === 'decline') return <X aria-hidden className={cls} />
  if (action === 'dispute') return <Gavel aria-hidden className={cls} />
  return <Check aria-hidden className={cls} />
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[0.6875rem] font-semibold tracking-[0.05em] text-ink-400 uppercase">
        {label}
      </h3>
      {children}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] font-medium text-ink-900">{value}</dd>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-[0.5rem] text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-900 [&>svg]:size-3.5"
    >
      {children}
    </button>
  )
}

/**
 * The confirmation step, in place rather than in a second dialog stacked on
 * the first. It restates what is about to happen in money terms — amount and
 * masked destination — because "Are you sure?" is a question nobody reads and
 * "Send GHS 42.00 to TR7NHq••••Lj6t?" is one they do.
 */
function ConfirmStep({
  action,
  request,
  masked,
  reason,
  setReason,
  onCancel,
  onConfirm,
}: {
  action: PayoutAction
  request: PayoutRequest
  masked: string
  reason: string
  setReason: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('admin.payouts')
  const format = useFormatter()
  const rule = ACTION_RULES[action]
  const ready = !rule.reason || reason.trim().length >= 3

  const ghs = `GHS ${format.number(request.ghs, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  return (
    <div>
      <p className="text-[0.8125rem] leading-relaxed font-medium text-ink-900">
        {t(`confirm.${action}`, { amount: ghs, destination: masked, name: request.user.name })}
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
