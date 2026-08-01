'use client'

import { useEffect, useState } from 'react'

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { REVEAL_SECONDS, maskDestination, nameMatches } from '@/lib/admin/destination'
import { holdEndsAt, type PayoutRequest } from '@/lib/admin/types'
import { cn } from '@/lib/cn'

import { PersonCell, StatusDot } from './AdminChrome'
import {
  DetailPanel,
  Fact,
  PanelFacts,
  PanelFooter,
  PanelIconButton,
  PanelSection as Section,
} from './DetailPanel'
import {
  ACTION_RULES,
  availableActions,
  effectiveRule,
  type PayoutAction,
} from './payout-actions'
import { PAYOUT_TONE } from './payout-status'
import { payoutHeadline } from './payout-amount'

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
  busy,
}: {
  request: PayoutRequest | null
  now: number
  onClose: () => void
  onDecide: (id: string, action: PayoutAction, reason: string, reference?: string) => void
  /** A decision is in flight. Every control that could start a second one
   *  goes inert — double-approving a payout is not a harmless duplicate. */
  busy: boolean
}) {
  if (!request) return null
  /* Keyed on the request, so opening a different payout mounts a fresh panel
     rather than resetting five pieces of state in an effect. That is not a
     tidiness point: carrying a revealed account number or a half-typed
     decline reason across from the previous payout is how the wrong person
     gets declined. React guarantees the reset; an effect only promises it. */
  return (
    <Panel
      key={request.id}
      request={request}
      now={now}
      onClose={onClose}
      onDecide={onDecide}
      busy={busy}
    />
  )
}

function Panel({
  request: r,
  now,
  onClose,
  onDecide,
  busy,
}: {
  request: PayoutRequest
  now: number
  onClose: () => void
  onDecide: (id: string, action: PayoutAction, reason: string, reference?: string) => void
  /** A decision is in flight. Every control that could start a second one
   *  goes inert — double-approving a payout is not a harmless duplicate. */
  busy: boolean
}) {
  const t = useTranslations('admin.payouts')
  const ts = useTranslations('admin.overview.status')
  const format = useFormatter()

  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState<PayoutAction | null>(null)
  const [reason, setReason] = useState('')

  /* Proof the transfer actually happened, for markPaid only. Optional, and
     that is the operator's rule holding: marking paid needs a confirmation,
     not a form. But it is offered, because "the money never arrived" is a
     message this platform will receive, and the answer to it is a MoMo
     transaction id — one nobody can produce later if there was never
     anywhere to put it. */
  const [reference, setReference] = useState('')

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

  const actions = availableActions(r)
  const ghs = (n: number) =>
    `GHS ${format.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  /*
    Operator rule, 2026-07-29: a crypto payout is denominated in the coin.
    Cedis are for mobile money. This drawer used to lead with a cedi figure on
    every request — including the one asking an operator to send a Tron
    transfer, which they cannot do from a cedi amount.

    Falls back to cedis only when there is genuinely no coin figure: no rate
    was frozen and none can be quoted now. Better a number in the wrong unit
    with the reason shown than a blank where the amount should be.
  */
  const payoutAmount = payoutHeadline(r, format)

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

  /**
   * Hands the decision up and then leaves the confirm step exactly as it is.
   *
   * A successful decision unmounts this panel from above, so there is nothing
   * to tidy. A refused one keeps the typed reason on screen — clearing it
   * here would mean an operator whose decline was rejected for a reason they
   * can fix has to write the whole explanation again.
   */
  const submit = () => {
    if (!pending || busy) return
    onDecide(r.id, pending, reason.trim(), reference.trim() || undefined)
  }

  /* Escape and the scrim both route through here, so a half-typed decline
     reason is never thrown away by a stray click or a reflexive Escape: the
     first one cancels the decision, the second closes the panel. */
  const requestClose = () => (pending ? setPending(null) : onClose())

  const start = (action: PayoutAction) => {
    if (busy) return
    const rule = effectiveRule(action, r)
    if (rule.confirm || rule.reason) {
      setPending(action)
      setReason('')
      setReference('')
    } else {
      onDecide(r.id, action, '')
    }
  }

  return (
    <DetailPanel
      title={t('drawer.title', { reference: r.reference })}
      closeLabel={t('drawer.close')}
      onClose={requestClose}
      header={
        <>
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
        </>
      }
      footer={
        actions.length > 0 && (
          <PanelFooter raised={Boolean(pending)}>
            {pending ? (
              <ConfirmStep
                action={pending}
                request={r}
                masked={masked}
                reason={reason}
                setReason={setReason}
                reference={reference}
                setReference={setReference}
                busy={busy}
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
                    disabled={busy}
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
          </PanelFooter>
        )
      }
    >
      {/* Amount. The largest thing in the panel, because it is the number
              the decision is actually about. */}
      <p className="text-[2rem] leading-none font-semibold tracking-[-0.02em] text-ink-900 tabular-nums">
        {payoutAmount.primary}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-ink-500 tabular-nums">
        {/* The cedi value stays visible underneath on a crypto request. It is
            what the platform actually owes and what every total is in; the
            coin figure on top is what gets sent. */}
        {r.method === 'crypto'
          ? t('drawer.cryptoSub', {
              ghs: ghs(r.ghs),
              points: r.points.toLocaleString(),
            })
          : t('drawer.pointsRate', {
              points: r.points.toLocaleString(),
              rate: format.number(r.points / r.ghs, { maximumFractionDigits: 0 }),
            })}
      </p>
      {/* The fee, spelled out, and ONLY when there is one. The big number
          above is the net — what to send — so the gross has to appear
          somewhere or the arithmetic against the user's balance looks wrong.
          The rate shown is the one frozen onto this request, not today's. */}
      {r.feeGhs > 0 && (
        <p className="mt-1.5 text-[0.75rem] text-ink-500 tabular-nums">
          {t('drawer.feeBreakdown', {
            gross: ghs(r.ghs),
            fee: ghs(r.feeGhs),
            percent: format.number(r.feePercent, { maximumFractionDigits: 2 }),
          })}
        </p>
      )}
      {payoutAmount.caveat && (
        <p className="mt-1.5 text-[0.75rem] text-warning-700">{t(payoutAmount.caveat)}</p>
      )}

      {/* ---- Destination ----------------------------------------- */}
      <Section label={t('drawer.destination')}>
        <div className="rounded-(--radius-card) border border-ink-200 bg-ink-50/50 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.75rem] font-medium text-ink-600">{r.provider}</span>
            <div className="flex items-center gap-1">
              <PanelIconButton
                label={revealed ? t('drawer.hide') : t('drawer.reveal')}
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? <EyeOff /> : <Eye />}
              </PanelIconButton>
              <PanelIconButton label={t('drawer.copy')} onClick={copy}>
                {copied ? <Check className="text-success-600" /> : <Copy />}
              </PanelIconButton>
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
            {revealed
              ? t('drawer.revealNotice', { seconds: REVEAL_SECONDS })
              : t('drawer.maskNotice')}
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
                  nameOk ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-600',
                )}
              >
                {nameOk ? (
                  <Check aria-hidden className="size-3" />
                ) : (
                  <AlertTriangle aria-hidden className="size-3" />
                )}
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
        <div className="mt-3">
          <PanelFacts>
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
          </PanelFacts>
        </div>
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
                r.risk === 'critical' || r.risk === 'high' ? 'text-danger-700' : 'text-warning-600',
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
    </DetailPanel>
  )
}

/* ------------------------------------------------------------------ */

function ActionIcon({ action }: { action: PayoutAction }) {
  const cls = 'size-4'
  if (action === 'hold') return <Clock aria-hidden className={cls} />
  if (action === 'decline') return <X aria-hidden className={cls} />
  return <Check aria-hidden className={cls} />
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
  reference,
  setReference,
  busy,
  onCancel,
  onConfirm,
}: {
  action: PayoutAction
  request: PayoutRequest
  masked: string
  reason: string
  setReason: (v: string) => void
  reference: string
  setReference: (v: string) => void
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('admin.payouts')
  const format = useFormatter()
  const rule = effectiveRule(action, request)

  /* Approving a held request is a different act from approving a matured one,
     so it gets its own wording and its own copy key rather than reusing
     "approve" — the operator is waiving a fraud window, and the sentence
     above the box should say so. */
  const early = action === 'approve' && rule.reason
  const copyKey = early ? 'approveEarly' : action

  // The database demands five characters for an early reason and three for
  // the rest. Matching it here means the button goes live at the same moment
  // the request would be accepted.
  const minReason = early ? 5 : 3
  const ready = (!rule.reason || reason.trim().length >= minReason) && !busy

  const until = holdEndsAt(request)

  // The sentence an operator reads before they move money. It said
  // "Send GHS 42.00 to TR7NHq••••Lj6t" — a cedi figure, to a Tron wallet.
  const amount = payoutHeadline(request, format).primary

  return (
    <div>
      <p className="text-[0.8125rem] leading-relaxed font-medium text-ink-900">
        {t(`confirm.${copyKey}`, {
          amount,
          destination: masked,
          name: request.user.name,
          until: until
            ? format.dateTime(until, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })
            : t('confirm.untilLifted'),
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
            placeholder={t(`confirm.reasonPlaceholder.${copyKey}`)}
            className="mt-1 w-full resize-none rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
          />
          <span className="mt-1 block text-[0.625rem] text-ink-400">{t('confirm.reasonHint')}</span>
        </label>
      )}

      {/* Only on markPaid, and never required. This is the one action that
          asserts cash has left the business, and it is the one whose
          aftermath — "I never received it" — needs something to check
          against. */}
      {action === 'markPaid' && (
        <label className="mt-3 block">
          <span className="text-[0.6875rem] font-medium text-ink-500">
            {t('confirm.referenceLabel')}
          </span>
          <input
            autoFocus
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('confirm.referencePlaceholder')}
            className="mt-1 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2 font-mono text-[0.8125rem] text-ink-900 placeholder:font-sans placeholder:text-ink-400 focus:border-brand-600 focus:outline-none pointer-coarse:text-base"
          />
          <span className="mt-1 block text-[0.625rem] text-ink-400">
            {t('confirm.referenceHint')}
          </span>
        </label>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="md"
          variant="secondary"
          disabled={busy}
          onClick={onCancel}
          className="flex-1"
        >
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
          {busy ? t('confirm.working') : t(`actions.${action}`)}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  )
}
