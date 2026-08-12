import {
  ArrowDownLeft,
  FileText,
  Gamepad2,
  Gift,
  ListChecks,
  PlayCircle,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { AdsBreakdown } from '@/lib/earnings/breakdown'
import { cn } from '@/lib/cn'

/**
 * Where a user's money came from.
 *
 * ── CEDIS, NOWHERE ELSE ──
 *
 * Operator, 2026-08-12. Nothing on this page is a point and nothing is a
 * pesewa. `AdsBreakdown` carries cedis only, so there is no other unit here to
 * render by accident.
 *
 * ── IT HAS TO ADD UP ──
 *
 * Every one of the eleven ledger entry types is represented, including tasks
 * and administrative adjustments, and the footnote states the arithmetic out
 * loud: earned, less what has left or is leaving, is the balance on the Home
 * screen. A breakdown that does not reconcile with the number somebody already
 * knows is how you teach them not to trust either figure.
 *
 * ── SPENDING SITS APART FROM EARNING ──
 *
 * Also the operator's decision. What they paid for plans is stated as a fact
 * in its own section, never subtracted from earnings and never combined into a
 * single "you are up" figure. A plan buys a better rate on every ad; it is not
 * a deposit and this page must not read as though it were.
 */
export function EarningsBreakdown({ data }: { data: AdsBreakdown }) {
  const t = useTranslations('earnings')
  const format = useFormatter()

  const money = (value: number) =>
    format.number(value, { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 })

  const find = (key: string) => data.sources.find((s) => s.key === key)?.cedis ?? 0

  const adjustments = find('adjustments')
  const nothingYet = data.earned === 0 && data.plansSpent === 0

  const groups = [
    {
      key: 'ads',
      Icon: PlayCircle,
      total: data.adsTotal,
      always: true,
      parts: [
        { key: 'videos', Icon: PlayCircle, cedis: find('videos') },
        { key: 'surveys', Icon: ListChecks, cedis: find('surveys') },
        { key: 'articles', Icon: FileText, cedis: find('articles') },
      ],
    },
    {
      key: 'referrals',
      Icon: Users,
      total: data.referralsTotal,
      always: true,
      parts: [
        { key: 'referralSignup', Icon: UserPlus, cedis: find('referralSignup') },
        { key: 'referralActivation', Icon: Sparkles, cedis: find('referralActivation') },
        { key: 'referralPurchase', Icon: Wallet, cedis: find('referralPurchase') },
      ],
    },
    { key: 'games', Icon: Gamepad2, total: find('games'), always: true, parts: [] },
    { key: 'tasks', Icon: Target, total: find('tasks'), always: true, parts: [] },
    { key: 'giftCodes', Icon: Gift, total: find('giftCodes'), always: true, parts: [] },
    /* Only when it exists, and it can be negative. An adjustment nobody made
       is not a category; one that took money away is not optional. */
    {
      key: 'adjustments',
      Icon: SlidersHorizontal,
      total: adjustments,
      always: adjustments !== 0,
      parts: [],
    },
  ].filter((g) => g.always || g.total !== 0)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 md:py-7">
      <header className="animate-rise">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {/* ---- The headline: everything earned, ever ---------------------- */}
      <section
        style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
        className="animate-rise mt-5 rounded-(--radius-panel) border border-ink-200 bg-surface p-5"
      >
        <p className="text-[0.75rem] font-medium tracking-[0.08em] text-ink-500 uppercase">
          {t('earnedLabel')}
        </p>
        <p className="mt-1 text-[2rem] leading-none font-bold tracking-[-0.02em] tabular-nums text-ink-900">
          {money(data.earned)}
        </p>
        {data.firstEarnedAt && (
          <p className="mt-1.5 text-[0.75rem] text-ink-500">
            {t('since', {
              when: format.dateTime(new Date(data.firstEarnedAt), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            })}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Figure label={t('balanceNow')} value={money(data.balance)} tone="brand" />
          <Figure label={t('paidOut')} value={money(data.paidOutNet)} />
          <Figure label={t('waiting')} value={money(data.pendingOut)} />
        </dl>
      </section>

      {nothingYet ? (
        <p className="animate-rise mt-5 rounded-(--radius-card) border border-dashed border-ink-200 px-4 py-10 text-center text-[0.875rem] text-ink-400">
          {t('empty')}
        </p>
      ) : (
        <>
          {/* ---- Where it came from -------------------------------------- */}
          <Section title={t('sourcesTitle')} delay="0.1s">
            <ul className="divide-y divide-ink-100">
              {groups.map((group) => (
                <li key={group.key} className="py-3 first:pt-0 last:pb-0">
                  <Row
                    Icon={group.Icon}
                    label={t(`source.${group.key}`)}
                    value={money(group.total)}
                    strong
                  />
                  {/* The parts only when the whole is worth breaking up. Three
                      rows of nothing under a heading of nothing is noise. */}
                  {group.total !== 0 && group.parts.length > 0 && (
                    <ul className="mt-2 space-y-1.5 pl-9">
                      {group.parts
                        .filter((p) => p.cedis !== 0)
                        .map((part) => (
                          <li key={part.key}>
                            <Row
                              Icon={part.Icon}
                              label={t(`source.${part.key}`)}
                              value={money(part.cedis)}
                              muted
                            />
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          {/* ---- Money out ---------------------------------------------- */}
          <Section title={t('outTitle')} delay="0.15s">
            <ul className="divide-y divide-ink-100">
              <li className="py-3 first:pt-0">
                <Row Icon={ArrowDownLeft} label={t('out.paid')} value={money(data.paidOutNet)} />
              </li>
              {data.fees > 0 && (
                <li className="py-3">
                  <Row
                    Icon={SlidersHorizontal}
                    label={t('out.fees')}
                    value={money(data.fees)}
                    muted
                  />
                </li>
              )}
              <li className="py-3">
                <Row Icon={Wallet} label={t('out.pending')} value={money(data.pendingOut)} muted />
              </li>
              {data.refundedOut > 0 && (
                <li className="py-3 last:pb-0">
                  <Row
                    Icon={ArrowDownLeft}
                    label={t('out.refunded')}
                    value={money(data.refundedOut)}
                    muted
                  />
                </li>
              )}
            </ul>
            <p className="mt-3 border-t border-ink-100 pt-3 text-[0.75rem] leading-relaxed text-ink-500">
              {t('reconcile', {
                earned: money(data.earned),
                out: money(data.paidOut + data.pendingOut),
                balance: money(data.balance),
              })}
            </p>
          </Section>

          {/* ---- Plans, deliberately not netted -------------------------- */}
          <Section title={t('plansTitle')} delay="0.2s">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[1.375rem] font-semibold tabular-nums text-ink-900">
                {money(data.plansSpent)}
              </p>
              <p className="text-[0.8125rem] text-ink-500">
                {t('plansCount', { count: data.plansCount })}
              </p>
            </div>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-500">{t('plansNote')}</p>
          </Section>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  delay,
  children,
}: {
  title: string
  delay: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{ '--rise-delay': delay } as React.CSSProperties}
      className="animate-rise mt-5 rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5"
    >
      <h2 className="mb-3 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'brand' }) {
  return (
    <div className="rounded-(--radius-input) bg-ink-50 px-2.5 py-2 text-center">
      <dt className="text-[0.6875rem] leading-tight text-ink-500">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[0.9375rem] font-semibold tracking-[-0.01em] tabular-nums',
          tone === 'brand' ? 'text-brand-700' : 'text-ink-900',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function Row({
  Icon,
  label,
  value,
  strong,
  muted,
}: {
  Icon: typeof PlayCircle
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center rounded-full',
          muted ? 'size-5 text-ink-400' : 'size-7 bg-ink-100 text-ink-600',
        )}
      >
        <Icon className={muted ? 'size-3.5' : 'size-4'} strokeWidth={muted ? 2 : 2.2} />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          muted ? 'text-[0.8125rem] text-ink-500' : 'text-[0.875rem] text-ink-800',
          strong && 'font-medium text-ink-900',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'shrink-0 tabular-nums',
          muted
            ? 'text-[0.8125rem] text-ink-500'
            : 'text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900',
        )}
      >
        {value}
      </span>
    </div>
  )
}
