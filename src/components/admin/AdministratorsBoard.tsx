'use client'

import { useState, useTransition } from 'react'

import { Mail, ShieldCheck, ShieldOff, UserMinus, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  changeAdminRole,
  inviteAdmin,
  revokeAdmin,
} from '@/app/[locale]/admin/(super)/settings/actions'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { Administrator } from '@/lib/admin/data/administrators'
import { ADMIN_ROLES, type AdminRole } from '@/lib/admin/role-types'
import { cn } from '@/lib/cn'

/**
 * Who has the keys, and the three things a super admin can do about it.
 *
 * WHY THE WHOLE LIST COMES BACK from every action — the same rule the payout
 * queue and the people board follow. The screen renders what the DATABASE did,
 * not what the browser predicted, so a second operator working in another tab
 * shows up here instead of being silently painted over. It also means the two
 * refusals the database makes on purpose (you cannot revoke yourself, and
 * there must always be one super admin) arrive as a message beside the row
 * rather than as a row that appears to change and then does not.
 *
 * The actions live behind a kebab rather than as buttons in the row, which is
 * the rule for every admin table here since the payout queue review: three
 * stacked buttons per row was rejected, and revoking somebody's access is not
 * something to put one mis-tap away.
 */

const ROLE_TONE: Record<AdminRole, string> = {
  super_admin: 'bg-brand-50 text-brand-700 border-brand-500/25',
  support: 'bg-teal-50 text-teal-700 border-teal-500/25',
  ads_manager: 'bg-violet-50 text-violet-700 border-violet-500/25',
}

export function AdministratorsBoard({ initial }: { initial: Administrator[] }) {
  const t = useTranslations('admin.adminSettings.administrators')
  const [admins, setAdmins] = useState(initial)
  const [pending, start] = useTransition()

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminRole>('support')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const invite = () =>
    start(async () => {
      setNotice(null)
      const result = await inviteAdmin({ email, role })
      if (result.ok) {
        setAdmins(result.admins)
        setEmail('')
        // Two different true things: a brand-new account was emailed an
        // invitation, or somebody who already had an account was simply given
        // a role and will see it next time they sign in.
        setNotice({ tone: 'ok', text: result.emailed ? t('sent', { email }) : t('granted') })
      } else {
        setNotice({ tone: 'bad', text: result.error })
      }
    })

  const setRoleFor = (userId: string, next: AdminRole) =>
    start(async () => {
      setNotice(null)
      const result = await changeAdminRole({ userId, role: next })
      if (result.ok) setAdmins(result.admins)
      else setNotice({ tone: 'bad', text: result.error })
    })

  const revoke = (userId: string) =>
    start(async () => {
      setNotice(null)
      const result = await revokeAdmin({ userId })
      if (result.ok) setAdmins(result.admins)
      else setNotice({ tone: 'bad', text: result.error })
    })

  const menuFor = (person: Administrator): MenuItem[] => [
    ...ADMIN_ROLES.filter((r) => r !== person.role).map((r) => ({
      key: r,
      label: t('makeRole', { role: t(`roles.${r}`) }),
      icon: <ShieldCheck />,
      onSelect: () => setRoleFor(person.id, r),
    })),
    {
      key: 'revoke',
      label: t('revoke'),
      icon: <UserMinus />,
      tone: 'danger' as const,
      separated: true,
      // Said before the click rather than after it. The database refuses both
      // of these, but a menu item that explains itself is better than an error.
      hint: person.isYou ? t('cannotRevokeSelf') : undefined,
      disabled: person.isYou,
      onSelect: () => revoke(person.id),
    },
  ]

  return (
    <div>
      {/* ---- Invite ------------------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-2 border-b border-ink-200 px-4 py-3.5">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[0.75rem] font-medium text-ink-600">
            {t('inviteEmail')}
          </span>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('invitePlaceholder')}
            className="h-9 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 text-[0.875rem] text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500"
          />
        </label>

        <label>
          <span className="mb-1 block text-[0.75rem] font-medium text-ink-600">
            {t('inviteRole')}
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
            className="h-9 rounded-(--radius-input) border border-ink-200 bg-canvas px-2 text-[0.875rem] text-ink-900 outline-none focus:border-brand-500"
          >
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={invite}
          disabled={pending || email.trim().length < 3}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-(--radius-input) px-3',
            'text-[0.8125rem] font-semibold transition-colors',
            'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50',
          )}
        >
          <UserPlus aria-hidden className="size-4" />
          {t('inviteAction')}
        </button>
      </div>

      {notice && (
        <p
          className={cn(
            'px-4 py-2.5 text-[0.75rem] leading-relaxed',
            notice.tone === 'ok'
              ? 'bg-success-50 text-success-700'
              : 'bg-danger-50 text-danger-700',
          )}
        >
          {notice.text}
        </p>
      )}

      {/* ---- Who has the keys -------------------------------------------- */}
      <ul className="divide-y divide-ink-200">
        {admins.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.875rem] font-semibold text-ink-900">
                {a.name}
                {a.isYou && <span className="font-normal text-ink-500"> · {t('you')}</span>}
              </p>
              <p className="truncate text-[0.75rem] text-ink-500">{a.email}</p>
            </div>

            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold',
                a.role ? ROLE_TONE[a.role] : 'border-ink-200 bg-ink-100 text-ink-600',
              )}
            >
              {a.role ? t(`roles.${a.role}`) : '—'}
            </span>

            {/* An invitation nobody has accepted is not yet a person with
                access, and saying so is the difference between a list of
                administrators and a list of intentions. */}
            {!a.accepted && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning-500/25 bg-warning-50 px-2 py-0.5 text-[0.6875rem] font-medium text-warning-700">
                <Mail aria-hidden className="size-3" />
                {t('invited')}
              </span>
            )}

            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium',
                a.twoFactor ? 'text-success-600' : 'text-warning-600',
              )}
            >
              {a.twoFactor ? (
                <ShieldCheck aria-hidden className="size-3.5" />
              ) : (
                <ShieldOff aria-hidden className="size-3.5" />
              )}
              {t(a.twoFactor ? 'twoFactorOn' : 'twoFactorOff')}
            </span>

            <MoreMenu items={menuFor(a)} label={t('actionsFor', { name: a.name })} />
          </li>
        ))}
      </ul>
    </div>
  )
}
