'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, Lock, Mail, MailCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { changeEmail } from '@/app/[locale]/(app)/profile/credentials/actions'
import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { useRouter } from '@/i18n/navigation'

/**
 * Change the sign-in email.
 *
 * Identity is proved by the current password plus, when 2FA is on, an
 * authenticator code — never an emailed code (operator direction 2026-07-25).
 *
 * The address does not switch on submit: Supabase sends a confirmation link to
 * the NEW inbox and the change lands when it is opened. That is not identity
 * verification, it is ownership — without it a mistyped address would move
 * sign-in to a mailbox the user cannot open. The success screen says so
 * plainly, because "nothing appears to have changed" is otherwise alarming.
 */
export function ChangeEmailForm({
  currentEmail,
  needsCode,
}: {
  currentEmail: string
  needsCode: boolean
}) {
  const t = useTranslations('credentials')
  const tf = useTranslations('twoFactor')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const errText = (r: {
    errorKey?: string
    message?: string
    retryAfter?: string
    attemptsLeft?: number
  }): string => {
    if (r.errorKey === 'locked') {
      const minutes = r.retryAfter
        ? Math.max(1, Math.ceil((new Date(r.retryAfter).getTime() - Date.now()) / 60000))
        : 15
      return tf('errors.locked', { minutes })
    }
    if (r.errorKey === 'wrongCode') {
      return typeof r.attemptsLeft === 'number'
        ? tf('errors.wrongCodeAttempts', { attempts: r.attemptsLeft })
        : tf('errors.wrongCode')
    }
    if (r.errorKey) return t(`errors.${r.errorKey}` as 'errors.generic')
    return r.message ?? t('errors.generic')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await changeEmail({
        newEmail: email,
        currentPassword: password,
        code: code || undefined,
      })
      if (!res.ok) {
        setCode('')
        return setError(errText(res))
      }
      setSent(true)
    })
  }

  if (sent) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-brand-50 text-brand-600">
            <MailCheck aria-hidden className="size-8" />
          </span>
          <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">{t('email.sentTitle')}</h2>
          <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('email.sentBody', { email })}
          </p>
          <p className="mt-3 max-w-[34ch] text-[0.75rem] leading-relaxed text-ink-400">
            {t('email.sentNote')}
          </p>
          <Button size="lg" fullWidth className="mt-7" onClick={() => router.push('/profile')}>
            {t('backToProfile')}
          </Button>
        </div>
      </div>
    )
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
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">
            {t('email.title')}
          </h1>
          <p className="text-[0.8125rem] text-ink-500">{t('email.subtitle')}</p>
        </div>
      </header>

      <form onSubmit={submit} className="animate-rise mt-6 flex flex-col gap-4">
        <TextField
          label={t('email.current')}
          value={currentEmail}
          leadingIcon={<Mail />}
          disabled
          readOnly
        />

        <TextField
          label={t('email.new')}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(null)
          }}
          leadingIcon={<Mail />}
          inputMode="email"
          autoComplete="email"
          placeholder={t('email.newPlaceholder')}
          required
        />

        <PasswordField
          label={t('email.password')}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
          showChecklist={false}
          autoComplete="current-password"
          required
        />

        {needsCode && (
          <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4">
            <div className="flex items-center gap-2">
              <Lock aria-hidden className="size-4 text-brand-600" />
              <p className="text-[0.8125rem] font-medium text-ink-900">{t('stepUp.title')}</p>
            </div>
            <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-500">{t('stepUp.body')}</p>
            <div className="mt-3">
              <CodeInput
                value={code}
                onChange={(v) => {
                  setCode(v)
                  setError(null)
                }}
                label={t('stepUp.title')}
                digitLabel={(position) => tf('digit', { position })}
                labelHidden
                disabled={pending}
              />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-[0.8125rem] font-medium text-danger-600">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!email || !password || (needsCode && code.length < 6)}
        >
          {t('email.cta')}
        </Button>
      </form>
    </div>
  )
}
