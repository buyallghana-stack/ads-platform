'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, Check, Lock, Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { changePhone } from '@/app/[locale]/(app)/profile/credentials/actions'
import { SmsCodeStep } from '@/components/auth/SmsCodeStep'
import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { PasswordField } from '@/components/ui/PasswordField'
import { ReadOnlyField } from '@/components/ui/ReadOnlyField'
import { TextField } from '@/components/ui/TextField'
import { useRouter } from '@/i18n/navigation'

/**
 * Change the sign-in phone.
 *
 * Current password (and an authenticator code when 2FA is on) prove it is the
 * owner. The first press texts a code to the NEW number; typing it back proves
 * the number is theirs and makes the change. The old number is told.
 */
export function ChangePhoneForm({ currentPhone, needsCode }: { currentPhone: string; needsCode: boolean }) {
  const t = useTranslations('credentials')
  const tf = useTranslations('twoFactor')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [smsSent, setSmsSent] = useState(false)
  const [sms, setSms] = useState('')
  const [smsError, setSmsError] = useState<string | null>(null)
  const [resendSeconds, setResendSeconds] = useState(60)
  const [done, setDone] = useState(false)

  const errText = (r: {
    errorKey?: string
    message?: string
    retryAfter?: string
    attemptsLeft?: number
  }): string => {
    const minutes = r.retryAfter
      ? Math.max(1, Math.ceil((new Date(r.retryAfter).getTime() - Date.now()) / 60000))
      : 15
    if (r.errorKey === 'locked') return tf('errors.locked', { minutes })
    if (r.errorKey === 'wrongCode') {
      return typeof r.attemptsLeft === 'number'
        ? tf('errors.wrongCodeAttempts', { attempts: r.attemptsLeft })
        : tf('errors.wrongCode')
    }
    if (r.errorKey) {
      return t(`errors.${r.errorKey}` as 'errors.generic', { minutes, attempts: r.attemptsLeft ?? 0 })
    }
    return r.message ?? t('errors.generic')
  }

  const attempt = (withSms: string | undefined) =>
    changePhone({ newPhone: phone, currentPassword: password, code: code || undefined, smsCode: withSms })

  const submit = (e?: React.FormEvent, typed?: string) => {
    e?.preventDefault()
    setError(null)
    setSmsError(null)
    startTransition(async () => {
      const res = await attempt(smsSent ? (typed ?? sms) : undefined)
      if (!res.ok) {
        if (res.smsField) {
          setSms('')
          return setSmsError(errText(res))
        }
        setCode('')
        return setError(errText(res))
      }
      if (res.smsSent) {
        setSmsSent(true)
        setResendSeconds(res.resendSeconds ?? 60)
        return
      }
      setDone(true)
      router.refresh()
    })
  }

  const resend = async (): Promise<number | null> => {
    const res = await attempt(undefined)
    if (res.ok && res.smsSent) return res.resendSeconds ?? 60
    if (!res.ok) setSmsError(errText(res))
    return null
  }

  if (done) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-success-50 text-success-600">
            <Check aria-hidden className="size-8" strokeWidth={2.5} />
          </span>
          <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">{t('phone.doneTitle')}</h2>
          <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('phone.doneBody')}
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
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('phone.title')}</h1>
          <p className="text-[0.8125rem] text-ink-500">{t('phone.subtitle')}</p>
        </div>
      </header>

      <form method="post" onSubmit={submit} className="animate-rise mt-6 flex flex-col gap-4">
        <ReadOnlyField label={t('phone.current')} value={currentPhone} leadingIcon={<Phone />} />

        <TextField
          label={t('phone.new')}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="024 123 4567"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setError(null)
            setSmsSent(false)
          }}
          leadingIcon={<Phone />}
          required
        />

        <PasswordField
          label={t('phone.password')}
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

        {smsSent && (
          <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4">
            <p className="mb-2 text-[0.8125rem] font-medium text-ink-900">{t('sms.titleNew')}</p>
            <SmsCodeStep
              phone={phone}
              value={sms}
              onChange={(v) => {
                setSms(v)
                setSmsError(null)
              }}
              onComplete={(v) => submit(undefined, v)}
              onResend={resend}
              resendSeconds={resendSeconds}
              error={smsError}
              disabled={pending}
            />
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
          disabled={!phone || !password || (needsCode && code.length < 6) || (smsSent && sms.length < 6)}
        >
          {smsSent ? t('phone.cta') : t('sms.send')}
        </Button>
      </form>
    </div>
  )
}
