'use client'

import { useState, useTransition } from 'react'

import {
  AlertTriangle,
  Check,
  Gamepad2,
  Loader2,
  Mail,
  MessageSquare,
  ShieldCheck,
  ShieldOff,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  changeAdminRole,
  inviteAdmin,
  resendInvite,
  revokeAdmin,
} from '@/app/[locale]/admin/(super)/settings/actions'
import { Avatar } from '@/components/profile/Avatar'
import { MoreMenu, type MenuItem } from '@/components/ui/MoreMenu'
import type { Administrator } from '@/lib/admin/data/administrators'
import { ADMIN_ROLES, type AdminRole } from '@/lib/admin/role-types'
import { cn } from '@/lib/cn'

/**
 * Who has the keys, and the three things a super admin can do about it.
 *
 * REBUILT 2026-07-31 after the operator's verdict on the first attempt ("the
 * UI sucks and also it doesnt work well"). Both halves of that were fair:
 *
 *   - Inviting somebody appeared to do NOTHING. The action called
 *     `revalidatePath` on the page it was invoked from, which remounted this
 *     component and threw away the "invitation sent" notice before anybody
 *     could read it. The action no longer revalidates; the fresh list comes
 *     back in the result, the way the payout queue already worked.
 *   - The form was three controls jammed into one row, with the roles named
 *     but never explained, so the choice being made — who can see the payout
 *     queue — was the least legible thing on the screen.
 *
 * What it says now: each role is a card you pick, with the sentence that
 * actually matters underneath it. A person is a row with their standing on it,
 * not a name and a coloured word.
 *
 * WHY THE WHOLE LIST COMES BACK from every action — the rule the payout queue
 * and people board follow. The screen renders what the DATABASE did, not what
 * the browser predicted, so a second operator working in another tab shows up
 * instead of being painted over, and the two refusals the database makes on
 * purpose (you cannot revoke yourself; there must always be one super admin)
 * arrive as a message rather than as a row that seems to change and does not.
 */

const ROLE_ICON: Record<AdminRole, typeof ShieldCheck> = {
  super_admin: ShieldCheck,
  support: MessageSquare,
  ads_manager: Gamepad2,
}

const ROLE_TONE: Record<AdminRole, string> = {
  super_admin: 'bg-brand-50 text-brand-700 border-brand-500/25',
  support: 'bg-teal-50 text-teal-700 border-teal-500/25',
  ads_manager: 'bg-violet-50 text-violet-700 border-violet-500/25',
}

/** The signup trigger writes this when nobody has given a name yet. */
const PLACEHOLDER_NAME = 'Unnamed user'

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
        // Two different true things: a new account was emailed an invitation,
        // or somebody who already had one was simply given a role.
        setNotice({ tone: 'ok', text: result.emailed ? t('sent', { email }) : t('granted') })
        setEmail('')
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

  const resend = (person: Administrator) =>
    start(async () => {
      setNotice(null)
      const result = await resendInvite({ userId: person.id })
      if (result.ok) setNotice({ tone: 'ok', text: t('resent', { email: person.email }) })
      else setNotice({ tone: 'bad', text: result.error })
    })

  const menuFor = (person: Administrator): MenuItem[] => [
    // Only for somebody who has never signed in. Everybody else has a
    // password and a Forgot-password link of their own.
    ...(person.accepted
      ? []
      : [
          {
            key: 'resend',
            label: t('resend'),
            icon: <Mail />,
            onSelect: () => resend(person),
          },
        ]),
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
      // Said before the click rather than after it. The database refuses this
      // too, but a menu item that explains itself beats an error message.
      hint: person.isYou ? t('cannotRevokeSelf') : undefined,
      disabled: person.isYou,
      onSelect: () => revoke(person.id),
    },
  ]

  /* An invited account has no name until its owner sets one, and "Unnamed
     user" as the headline of a row is worse than the address that was
     actually typed into the invite. */
  const displayName = (person: Administrator) =>
    !person.name || person.name === PLACEHOLDER_NAME ? person.email : person.name

  return (
    <div>
      {/* ---- Invite ------------------------------------------------------ */}
      <div className="border-b border-ink-200 px-4 py-4">
        <label className="block">
          <span className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-800">
            {t('inviteEmail')}
          </span>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('invitePlaceholder')}
            className="h-10 w-full max-w-md rounded-(--radius-input) border border-ink-200 bg-canvas px-3 text-[0.875rem] text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500"
          />
        </label>

        {/* The role is the decision on this screen, so it is the biggest
            thing on it — and each option carries the sentence that says what
            it actually means for the payout queue. */}
        <fieldset className="mt-4">
          <legend className="mb-2 text-[0.8125rem] font-semibold text-ink-800">
            {t('inviteRole')}
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ADMIN_ROLES.map((r) => {
              const Icon = ROLE_ICON[r]
              const selected = r === role
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setRole(r)}
                  className={cn(
                    'flex flex-col gap-1 rounded-(--radius-card) border p-3 text-left transition-colors',
                    selected
                      ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500/25'
                      : 'border-ink-200 bg-surface hover:border-ink-300',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon
                      aria-hidden
                      className={cn('size-4', selected ? 'text-brand-600' : 'text-ink-400')}
                    />
                    <span className="text-[0.8125rem] font-semibold text-ink-900">
                      {t(`roles.${r}`)}
                    </span>
                    {selected && <Check aria-hidden className="ml-auto size-3.5 text-brand-600" />}
                  </span>
                  <span className="text-[0.75rem] leading-relaxed text-ink-500">
                    {t(`roleBlurb.${r}`)}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <button
          type="button"
          onClick={invite}
          disabled={pending || !email.includes('@')}
          className={cn(
            'mt-4 inline-flex h-10 items-center gap-2 rounded-(--radius-input) px-4',
            'text-[0.875rem] font-semibold transition-colors',
            'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50',
          )}
        >
          {pending ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <UserPlus aria-hidden className="size-4" />
          )}
          {t('inviteAction')}
        </button>

        <p className="mt-2 max-w-prose text-[0.75rem] leading-relaxed text-ink-500">
          {t('inviteHint')}
        </p>
      </div>

      {/* The result of the last thing pressed. Kept until the next action, so
          it cannot flash past somebody reading it. */}
      {notice && (
        <p
          role="status"
          className={cn(
            'flex items-start gap-2 px-4 py-3 text-[0.8125rem] leading-relaxed',
            notice.tone === 'ok'
              ? 'bg-success-50 text-success-700'
              : 'bg-danger-50 text-danger-700',
          )}
        >
          {notice.tone === 'ok' ? (
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </p>
      )}

      {/* ---- Who has the keys -------------------------------------------- */}
      <ul className="divide-y divide-ink-200">
        {admins.map((a) => {
          const RoleIcon = a.role ? ROLE_ICON[a.role] : ShieldOff
          return (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
              <Avatar name={displayName(a)} src={null} className="size-9 shrink-0 text-[0.75rem]" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.875rem] font-semibold text-ink-900">
                  {displayName(a)}
                  {a.isYou && <span className="font-normal text-ink-500"> · {t('you')}</span>}
                </p>
                {displayName(a) !== a.email && (
                  <p className="truncate text-[0.75rem] text-ink-500">{a.email}</p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold',
                      a.role ? ROLE_TONE[a.role] : 'border-ink-200 bg-ink-100 text-ink-600',
                    )}
                  >
                    <RoleIcon aria-hidden className="size-3" />
                    {a.role ? t(`roles.${a.role}`) : '—'}
                  </span>

                  {/* An invitation nobody has accepted is not yet somebody
                      with access, and saying so is the difference between a
                      list of administrators and a list of intentions. */}
                  {!a.accepted && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warning-500/25 bg-warning-50 px-2 py-0.5 text-[0.6875rem] font-medium text-warning-700">
                      <Mail aria-hidden className="size-3" />
                      {t('invited')}
                    </span>
                  )}

                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium',
                      a.twoFactor
                        ? 'border-success-500/25 bg-success-50 text-success-700'
                        : 'border-warning-500/25 bg-warning-50 text-warning-700',
                    )}
                  >
                    {a.twoFactor ? (
                      <ShieldCheck aria-hidden className="size-3" />
                    ) : (
                      <ShieldOff aria-hidden className="size-3" />
                    )}
                    {t(a.twoFactor ? 'twoFactorOn' : 'twoFactorOff')}
                  </span>
                </div>
              </div>

              <MoreMenu items={menuFor(a)} label={t('actionsFor', { name: displayName(a) })} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
