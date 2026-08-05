import { AlertTriangle, CalendarClock, Ban } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * The three notices no affiliate platform shows you, all reachable here on day
 * one. DESIGN.md call 6.
 *
 * Every one of them follows the same rule: state the fact, then say what it
 * means for the person reading, then say what happens next. A notice that only
 * does the first is how a support ticket starts.
 */

function Notice({
  tone,
  Icon,
  title,
  children,
}: {
  tone: 'warning' | 'danger'
  Icon: typeof AlertTriangle
  title: string
  children: React.ReactNode
}) {
  const TONE = {
    warning: 'border-warning-500/30 bg-warning-50 text-warning-600',
    danger: 'border-danger-500/30 bg-danger-50 text-danger-700',
  }[tone]

  return (
    <div className={cn('flex gap-3 rounded-(--radius-card) border p-3.5', TONE)}>
      <Icon aria-hidden className="mt-0.5 size-4.5 shrink-0" strokeWidth={2.2} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <div className="mt-1 space-y-1 text-[0.8125rem] leading-snug text-ink-700">{children}</div>
      </div>
    </div>
  )
}

/**
 * A negative commission balance.
 *
 * Reachable because `hold_days` is 0 while the refund window is 14 days: a
 * commission can be withdrawn and the sale refunded afterwards. Nobody has a
 * reference for this because most programmes hold commission long enough that
 * it cannot happen.
 *
 * `-GHS 40.00` on its own is alarming and unexplained, and the first thing the
 * reader will assume is that they owe money personally. So the card says three
 * things in order: a sale was refunded, payouts are paused until future
 * commission covers it, and nothing is owed. The third sentence is the one
 * that stops the support ticket.
 */
export function NegativeBalanceNotice({
  amount,
  labels,
}: {
  amount: string
  labels: { title: string; why: string; effect: string; reassure: string }
}) {
  return (
    <Notice tone="danger" Icon={AlertTriangle} title={labels.title}>
      <p>{labels.why}</p>
      <p>{labels.effect}</p>
      <p className="font-medium">{labels.reassure}</p>
      <p className="pt-0.5 text-lg font-semibold tabular-nums text-danger-700">{amount}</p>
    </Notice>
  )
}

/**
 * The right to promote is running out.
 *
 * Warned at 30, 7 and 1 days. Escalates from warning to danger inside the last
 * week, because the same tone for a month out and for tomorrow trains people to
 * ignore it.
 *
 * Market mode only. Day one is not the day to discover the entitlement was
 * time-limited, but neither is the ads dashboard the place to be told.
 */
export function ExpiryNotice({
  daysLeft,
  labels,
}: {
  daysLeft: number
  labels: { title: string; body: string; renew: string }
}) {
  return (
    <Notice
      tone={daysLeft <= 7 ? 'danger' : 'warning'}
      Icon={CalendarClock}
      title={labels.title}
    >
      <p>{labels.body}</p>
      <p className="font-medium">{labels.renew}</p>
    </Notice>
  )
}

/**
 * Suspended.
 *
 * Says who to contact. A dead end with no route out generates a support ticket
 * by design, and the person is already unhappy by the time they read it.
 */
export function SuspendedNotice({
  labels,
}: {
  labels: { title: string; body: string; contact: string }
}) {
  return (
    <Notice tone="danger" Icon={Ban} title={labels.title}>
      <p>{labels.body}</p>
      <p className="font-medium">{labels.contact}</p>
    </Notice>
  )
}
