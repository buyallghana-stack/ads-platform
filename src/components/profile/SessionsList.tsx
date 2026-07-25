'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, Info, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  revokeOtherSessions,
  revokeSession,
} from '@/app/[locale]/(app)/profile/sessions/actions'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

export type SessionRow = {
  id: string
  /** When this device signed in — captured from the real request, not GoTrue. */
  signedInAt: string
  lastSeen: string
  device: string
  browser: string | null
  os: string | null
  ip: string | null
  country: string | null
  isCurrent: boolean
}

/**
 * Where you are signed in, and how to end a session you do not recognise.
 *
 * The current device is pinned first and cannot be revoked from here — ending
 * it is what Log out is for, and doing it from a list of other devices is a
 * confusing way to get signed out.
 *
 * `now` is passed from the server so relative timestamps are computed from one
 * fixed instant: reading the clock during render is impure and makes the first
 * client render disagree with the server's.
 */
export function SessionsList({
  sessions,
  now,
}: {
  sessions: SessionRow[]
  now: number
}) {
  const t = useTranslations('sessions')
  const format = useFormatter()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const others = sessions.filter((s) => !s.isCurrent)

  const revokeOne = (id: string) => {
    setError(null)
    setBusyId(id)
    startTransition(async () => {
      const res = await revokeSession(id)
      setBusyId(null)
      if (!res.ok) return setError(t(`errors.${res.errorKey}` as 'errors.generic'))
      router.refresh()
    })
  }

  const revokeAll = () => {
    setError(null)
    startTransition(async () => {
      const res = await revokeOtherSessions()
      if (!res.ok) return setError(t(`errors.${res.errorKey}` as 'errors.generic'))
      router.refresh()
    })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/profile')}
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-4.5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
          <p className="text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
        </div>
      </header>

      <ul className="animate-rise mt-6 flex flex-col gap-2.5">
        {sessions.map((session) => (
          <li
            key={session.id}
            className={cn(
              'flex items-start gap-3 rounded-(--radius-card) border px-4 py-3.5',
              session.isCurrent
                ? 'border-success-500/25 bg-success-50'
                : 'border-ink-200 bg-surface',
            )}
          >
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full',
                session.isCurrent
                  ? 'bg-success-100 text-success-600'
                  : 'bg-ink-100 text-ink-500',
              )}
            >
              <DeviceIcon device={session.device} />
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'truncate text-[0.875rem] font-semibold',
                  session.isCurrent ? 'text-success-700' : 'text-ink-900',
                )}
              >
                {[session.device, session.browser].filter(Boolean).join(' · ')}
              </p>

              {/* Everything needed to answer "was this me?": the OS, where it
                  connected from, when it signed in, and when it was last used. */}
              <dl
                className={cn(
                  'mt-1 flex flex-col gap-0.5 text-[0.75rem] leading-relaxed',
                  session.isCurrent ? 'text-success-700/85' : 'text-ink-500',
                )}
              >
                {session.os && (
                  <div className="flex gap-1.5">
                    <dt className="sr-only">{t('labels.os')}</dt>
                    <dd>{session.os}</dd>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <dt className="sr-only">{t('labels.location')}</dt>
                  <dd>{[session.ip, session.country].filter(Boolean).join(' · ') || t('unknownIp')}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="sr-only">{t('labels.signedIn')}</dt>
                  <dd>
                    {t('signedInAt', {
                      when: format.dateTime(new Date(session.signedInAt), {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="sr-only">{t('labels.lastActive')}</dt>
                  <dd className={session.isCurrent ? 'font-medium' : undefined}>
                    {session.isCurrent
                      ? t('thisDevice')
                      : t('lastActive', {
                          when: format.relativeTime(new Date(session.lastSeen), now),
                        })}
                  </dd>
                </div>
              </dl>
            </div>

            {!session.isCurrent && (
              <button
                type="button"
                onClick={() => revokeOne(session.id)}
                disabled={pending}
                className="shrink-0 rounded-(--radius-input) px-2 py-1 text-[0.75rem] font-medium text-danger-600 transition-colors hover:bg-danger-50 disabled:opacity-50"
              >
                {busyId === session.id ? t('signingOut') : t('signOut')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}

      {others.length > 0 && (
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          className="mt-4"
          loading={pending && !busyId}
          onClick={revokeAll}
        >
          <LogOut aria-hidden className="size-4" />
          {t('signOutAll', { count: others.length })}
        </Button>
      )}

      {/* The honest caveat: revoking kills the refresh token, not a token the
          device is already holding. */}
      <div className="mt-4 flex items-start gap-2.5 rounded-(--radius-card) border border-ink-200 bg-ink-50 px-4 py-3">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-500" />
        <p className="text-[0.75rem] leading-relaxed text-ink-600">{t('delayNote')}</p>
      </div>
    </div>
  )
}

function DeviceIcon({ device }: { device: string }) {
  if (/phone|iphone/i.test(device)) return <Smartphone aria-hidden className="size-4.5" />
  if (/ipad|tablet/i.test(device)) return <Tablet aria-hidden className="size-4.5" />
  return <Monitor aria-hidden className="size-4.5" />
}
