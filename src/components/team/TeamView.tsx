'use client'

import { useState } from 'react'

import { ArrowUpRight, Coins, Gem, Info, Users, Wallet } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { ReferralCard } from '@/components/dashboard/ReferralCard'
import { Avatar } from '@/components/profile/Avatar'
import { StatCard } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import {
  TEAM_SCOPES,
  type TeamData,
  type TeamMember,
  type TeamScope,
  membersFor,
  totalsFor,
} from '@/lib/team/types'

/**
 * The Team screen.
 *
 * Asked for by the operator on 2026-07-31 on their lawyer's recommendation,
 * and the reason is the design brief: TRANSPARENCY. A user who is told they
 * earn from the people they introduce should be able to see those people and
 * what their activity is worth, so nobody can later say they were kept in the
 * dark. Every figure is therefore in CEDIS — points would be a unit only we
 * can price, which is the opposite of the point.
 *
 * NO DESIGN REFERENCE WAS SUPPLIED for this screen; the operator asked for
 * inspiration tuned to our own pattern. So it is built entirely out of idioms
 * this app already uses, which is also the strongest defence against it
 * looking like a generic dashboard:
 *
 *   - the segmented tab strip from Ads, Notifications and the Leaderboard,
 *     here carrying All / Level 1 / Level 2 — which is also how the screen
 *     answers "on level 1 and level 2" without cramming two figures into
 *     every tile;
 *   - the StatCard tiles from Home, in their fixed tone meanings (violet for
 *     plans, success for money in, teal for money out, orange for referrals);
 *   - the balance hero's currency treatment — a small muted GHS in front of a
 *     large tabular number, which is what stops "GHS 1,234.56" outgrowing a
 *     tile on a 390px phone;
 *   - the Transaction History split: a card feed below md, a table from md up.
 *
 * THE ONE THING THAT IS NOT BORROWED is the closing note. This screen shows
 * other people their team-mates' phone numbers and balances, so it says out
 * loud that the same is visible about them, to whoever invited them. A
 * disclosure the user has to find in a policy is not much of a disclosure.
 */

/** The balance hero's currency treatment, sized for a tile: a small muted
 *  GHS in front of a large tabular number. Defined here rather than inside the
 *  view because a component created during render is a new component type on
 *  every render. */
function Cedis({ amount }: { amount: string }) {
  return (
    <>
      <span className="mr-1 align-top text-[0.8125rem] font-semibold leading-[2.1] text-ink-400">
        GHS
      </span>
      {amount}
    </>
  )
}

const LEVEL_TONE: Record<number, string> = {
  1: 'bg-brand-50 text-brand-700 border-brand-500/25',
  2: 'bg-violet-50 text-violet-700 border-violet-500/25',
}

export function TeamView({ data }: { data: TeamData }) {
  const t = useTranslations('team')
  const format = useFormatter()

  const [scope, setScope] = useState<TeamScope>('all')
  const totals = totalsFor(data, scope)
  const members = membersFor(data, scope)

  const money = (value: number) =>
    format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  /** "Platinum + 2" — the highest plan they hold, and how many more. */
  const planLabel = (member: TeamMember) =>
    member.extraPlans > 0 ? `${member.topPlan} + ${member.extraPlans}` : member.topPlan

  const hasTeam = data.members.length > 0

  return (
    <div className="mx-auto w-full max-w-4xl px-1 pb-28 pt-2 md:pb-10">
      <header className="animate-rise">
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h1>
        <p className="mt-1 text-[0.875rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {hasTeam ? (
        <>
          {/* Scope — the same segmented idiom as Ads and the Leaderboard. */}
          <div
            role="tablist"
            aria-label={t('tabs.label')}
            style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
            className="animate-rise mt-4 flex gap-1 rounded-(--radius-input) bg-ink-100 p-1"
          >
            {TEAM_SCOPES.map((key) => {
              const selected = key === scope
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setScope(key)}
                  className={cn(
                    'flex-1 rounded-[calc(var(--radius-input)-0.25rem)] px-2 py-2.5',
                    'text-[0.8125rem] font-semibold transition-colors sm:text-[0.875rem]',
                    selected
                      ? 'bg-surface text-ink-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.08)]'
                      : 'text-ink-500 hover:text-ink-700',
                  )}
                >
                  {t(`tabs.${key}`)}
                </button>
              )
            })}
          </div>

          {/* The four figures the brief names, for whichever scope is selected. */}
          <div
            style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
            className="animate-rise mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <StatCard
              label={t('stats.plans')}
              value={format.number(totals.plansBought)}
              sublabel={t('stats.peopleCount', { count: totals.people })}
              tone="violet"
              icon={<Gem />}
            />
            <StatCard
              label={t('stats.worth')}
              value={<Cedis amount={money(totals.plansValue)} />}
              sublabel={t('stats.worthHint')}
              tone="success"
              icon={<Coins />}
            />
            <StatCard
              label={t('stats.withdrawn')}
              value={<Cedis amount={money(totals.redeemed)} />}
              sublabel={t('stats.withdrawnHint')}
              tone="teal"
              icon={<ArrowUpRight />}
            />
            <StatCard
              label={t('stats.left')}
              value={<Cedis amount={money(totals.remaining)} />}
              sublabel={t('stats.leftHint')}
              tone="orange"
              icon={<Wallet />}
            />
          </div>

          {/* ---- The people ------------------------------------------------ */}
          <div
            style={{ '--rise-delay': '0.15s' } as React.CSSProperties}
            className="animate-rise mt-5 overflow-hidden rounded-(--radius-panel) border border-ink-200 bg-surface"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
              <h2 className="text-[0.9375rem] font-semibold text-ink-900">{t('list.title')}</h2>
              <span className="text-[0.8125rem] tabular-nums text-ink-500">
                {t('list.count', { count: members.length })}
              </span>
            </div>

            {members.length === 0 ? (
              <p className="px-4 py-10 text-center text-[0.875rem] text-ink-500">
                {t(scope === 'level2' ? 'list.emptyLevel2' : 'list.emptyLevel1')}
              </p>
            ) : (
              <>
                {/* Mobile: a card per person. */}
                <ol className="divide-y divide-ink-200 md:hidden">
                  {members.map((member, index) => (
                    <li key={member.id} className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <span className="mt-1 w-5 shrink-0 text-[0.75rem] font-semibold tabular-nums text-ink-400">
                          {index + 1}
                        </span>
                        <Avatar name={member.name} src={member.avatarUrl} className="size-9 text-[0.75rem]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-[0.9375rem] font-semibold text-ink-900">
                              {member.name ?? t('list.noName')}
                            </p>
                            {scope === 'all' && (
                              <span
                                className={cn(
                                  'shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold',
                                  LEVEL_TONE[member.level],
                                )}
                              >
                                {t(`level.${member.level}`)}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[0.8125rem] tabular-nums text-ink-500">
                            {member.phone ?? t('list.noPhone')}
                          </p>
                          <p className="mt-1.5 inline-flex rounded-full border border-ink-200 bg-ink-100 px-2 py-0.5 text-[0.75rem] font-medium text-ink-700">
                            {planLabel(member)}
                          </p>
                        </div>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-100 pt-3">
                        <div>
                          <dt className="text-[0.75rem] text-ink-400">{t('list.withdrawn')}</dt>
                          <dd className="mt-0.5 text-[0.9375rem] font-semibold tabular-nums text-ink-900">
                            GHS {money(member.redeemed)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[0.75rem] text-ink-400">{t('list.left')}</dt>
                          <dd className="mt-0.5 text-[0.9375rem] font-semibold tabular-nums text-ink-900">
                            GHS {money(member.remaining)}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ol>

                {/* md+: the same rows as a table. Wide columns appear at lg,
                    so nothing is squeezed at the breakpoint where the sidebar
                    has just taken 224px away. */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-[0.875rem]">
                    <thead>
                      <tr className="border-b border-ink-200 text-[0.75rem] font-medium uppercase tracking-[0.04em] text-ink-400">
                        <th scope="col" className="w-10 px-4 py-2.5 font-medium">
                          {t('list.number')}
                        </th>
                        <th scope="col" className="px-2 py-2.5 font-medium">
                          {t('list.member')}
                        </th>
                        <th scope="col" className="px-2 py-2.5 font-medium">
                          {t('list.plan')}
                        </th>
                        <th scope="col" className="hidden px-2 py-2.5 text-right font-medium lg:table-cell">
                          {t('list.bought')}
                        </th>
                        <th scope="col" className="px-2 py-2.5 text-right font-medium">
                          {t('list.withdrawn')}
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">
                          {t('list.left')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-200">
                      {members.map((member, index) => (
                        <tr key={member.id} className="transition-colors hover:bg-ink-100/60">
                          <td className="px-4 py-3 tabular-nums text-ink-400">{index + 1}</td>
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar
                                name={member.name}
                                src={member.avatarUrl}
                                className="size-8 text-[0.6875rem]"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="truncate font-semibold text-ink-900">
                                    {member.name ?? t('list.noName')}
                                  </p>
                                  {scope === 'all' && (
                                    <span
                                      className={cn(
                                        'shrink-0 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold',
                                        LEVEL_TONE[member.level],
                                      )}
                                    >
                                      {t(`level.${member.level}`)}
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-[0.8125rem] tabular-nums text-ink-500">
                                  {member.phone ?? t('list.noPhone')}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            <span className="inline-flex rounded-full border border-ink-200 bg-ink-100 px-2 py-0.5 text-[0.75rem] font-medium text-ink-700">
                              {planLabel(member)}
                            </span>
                          </td>
                          <td className="hidden px-2 py-3 text-right tabular-nums text-ink-600 lg:table-cell">
                            {member.plansBought > 0
                              ? t('list.boughtValue', {
                                  count: member.plansBought,
                                  value: money(member.plansValue),
                                })
                              : '—'}
                          </td>
                          <td className="px-2 py-3 text-right font-medium tabular-nums text-ink-900">
                            GHS {money(member.redeemed)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-ink-900">
                            GHS {money(member.remaining)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        /* Nobody yet. A Team screen with no way to build a team would be a
           dead end, so the empty state is the invite itself. */
        <div
          style={{ '--rise-delay': '0.05s' } as React.CSSProperties}
          className="animate-rise mt-4 flex flex-col gap-4"
        >
          <div className="rounded-(--radius-panel) border border-dashed border-ink-200 px-6 py-10 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-full border border-orange-500/25 bg-orange-50 text-orange-600">
              <Users aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{t('empty.title')}</p>
            <p className="mx-auto mt-1 max-w-sm text-[0.875rem] text-ink-500">{t('empty.body')}</p>
          </div>
          <ReferralCard code={data.code} />
        </div>
      )}

      {/* The disclosure, on the screen rather than only in the policy. With
          nobody on the team the first half of it would explain figures that
          are not there, so what remains is the half that is true either way:
          somebody sees this about YOU. */}
      <p
        style={{ '--rise-delay': '0.2s' } as React.CSSProperties}
        className="animate-rise mt-5 flex items-start gap-2 rounded-(--radius-panel) border border-ink-200 bg-ink-100/60 px-4 py-3 text-[0.8125rem] leading-relaxed text-ink-500"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-400" />
        <span>{t(hasTeam ? 'note' : 'noteEmpty')}</span>
      </p>
    </div>
  )
}
