'use client'

import { useState } from 'react'

import { Info, Users } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { ReferralCard } from '@/components/dashboard/ReferralCard'
import { Avatar } from '@/components/profile/Avatar'
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
 *   - a compact figure grid for the four totals, sized to be read as context
 *     rather than as the headline (see the note on it below);
 *   - the Transaction History split: a card feed below md, a table from md up.
 *
 * THE ONE THING THAT IS NOT BORROWED is the closing note. This screen shows
 * other people their team-mates' phone numbers and balances, so it says out
 * loud that the same is visible about them, to whoever invited them. A
 * disclosure the user has to find in a policy is not much of a disclosure.
 */

/*
  THE TILE-SIZING MACHINERY WENT WITH THE TILES (2026-08-12).

  `Cedis`, `cedisSize` and `iconIfItFits` existed to keep a large currency
  figure inside a `StatCard` at 390px: the value stepped down through three
  type sizes and gave up its icon before it gave up a digit. The summary is
  four small figures in one card now, so there is no tile left to overflow and
  nothing to measure. The reasoning is in the history if tiles ever return.
*/

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

          {/*
            THE SAME FOUR FIGURES, IN A QUARTER OF THE HEIGHT.

            Operator, 2026-08-12: this tab "fills the screen too much". It did:
            four `StatCard` tiles, each with an icon chip, a 2rem number and a
            sublabel, took about three hundred pixels of a 390px phone before
            the first team member appeared. The figures are a summary, and a
            summary that pushes the thing it summarises off the screen has the
            balance backwards.

            Nothing is lost. All four labels, all four values and all four
            hints are still here, in one card at a size that reads as context
            rather than as the headline.
          */}
          <div
            style={{ '--rise-delay': '0.1s' } as React.CSSProperties}
            className="animate-rise mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-(--radius-panel) border border-ink-200 bg-surface px-4 py-3.5 lg:grid-cols-4"
          >
            {[
              { label: t('stats.plans'), value: format.number(totals.plansBought), hint: t('stats.peopleCount', { count: totals.people }) },
              { label: t('stats.worth'), value: `GHS ${money(totals.plansValue)}`, hint: t('stats.worthHint') },
              { label: t('stats.withdrawn'), value: `GHS ${money(totals.redeemed)}`, hint: t('stats.withdrawnHint') },
              { label: t('stats.left'), value: `GHS ${money(totals.remaining)}`, hint: t('stats.leftHint') },
            ].map((figure) => (
              <div key={figure.label} className="min-w-0">
                <p className="truncate text-[0.6875rem] font-medium tracking-[0.04em] text-ink-500 uppercase">
                  {figure.label}
                </p>
                <p className="mt-0.5 truncate text-[1.0625rem] font-semibold tracking-[-0.01em] tabular-nums text-ink-900">
                  {figure.value}
                </p>
                <p className="mt-0.5 truncate text-[0.6875rem] leading-snug text-ink-400">
                  {figure.hint}
                </p>
              </div>
            ))}
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
                    /*
                      ONE BLOCK PER PERSON, NOT TWO.

                      Operator, 2026-08-12: "the referred person details looks
                      too big". It was ~170px each: a header block, then a
                      hairline, then a two-column money block with its own
                      labels and 0.9375rem values. Three people filled a phone
                      screen on their own.

                      Every field survives — name, phone, plan, level, what
                      they withdrew and what is left. The money moved onto one
                      line beneath the plan, labelled inline, which is how it
                      reads in a statement anyway. About 90px now.
                    */
                    <li key={member.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 w-4 shrink-0 text-[0.75rem] font-semibold tabular-nums text-ink-400">
                        {index + 1}
                      </span>
                      <Avatar
                        name={member.name}
                        src={member.avatarUrl}
                        className="size-8 text-[0.6875rem]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-[0.875rem] font-semibold text-ink-900">
                            {member.name ?? t('list.noName')}
                          </p>
                          {scope === 'all' && (
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-1.5 py-px text-[0.625rem] font-semibold',
                                LEVEL_TONE[member.level],
                              )}
                            >
                              {t(`level.${member.level}`)}
                            </span>
                          )}
                        </div>

                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.75rem] text-ink-500">
                          <span className="tabular-nums">{member.phone ?? t('list.noPhone')}</span>
                          <span aria-hidden className="text-ink-300">
                            ·
                          </span>
                          <span className="text-ink-700">{planLabel(member)}</span>
                        </p>

                        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[0.75rem] text-ink-500">
                          <span>{t('list.left')}</span>
                          <span className="font-semibold tabular-nums text-ink-900">
                            GHS {money(member.remaining)}
                          </span>
                          <span aria-hidden className="text-ink-300">
                            ·
                          </span>
                          <span>{t('list.withdrawn')}</span>
                          <span className="font-semibold tabular-nums text-ink-900">
                            GHS {money(member.redeemed)}
                          </span>
                        </p>
                      </div>
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
