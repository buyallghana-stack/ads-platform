'use client'

import { useState } from 'react'

import { ArrowLeft, CheckCircle2, KeyRound, Mail, Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { FormHeader } from '@/components/auth/FormHeader'
import { SmsCodeStep, useCodeErrorMessage } from '@/components/auth/SmsCodeStep'
import { Button } from '@/components/ui/Button'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import {
  forgotPasswordByEmailAction,
  requestPasswordResetAction,
  resetPasswordWithCodeAction,
} from '@/app/[locale]/(auth)/actions'
import { Link } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'
import { forgotPasswordEmailSchema, forgotPasswordSchema } from '@/lib/validation/auth'

/**
 * Forgotten password, by SMS code (since 2026-09-27).
 *
 *   phone  → a code is texted, if an account uses the number
 *   code   → the code and the new password, on one screen
 *   done   → sign in again (every session was ended)
 *
 * The "email" step is the way back for an account made before phone sign-in
 * that never proved a number. The server sends nothing to an account that has.
 *
 * Nothing on any step says whether the number has an account: on a platform
 * that pays out money, the list of registered numbers is what gets phished.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword')
  const msg = useAuthErrorMessage()
  const codeMsg = useCodeErrorMessage()

  const [step, setStep] = useState<'phone' | 'code' | 'done' | 'email' | 'emailSent'>('phone')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resendSeconds, setResendSeconds] = useState(60)
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const request = async (): Promise<number | null> => {
    setError(null)
    const res = await requestPasswordResetAction({ phone })
    if (res.ok) return 'codeSent' in res ? res.resendSeconds : 60
    if (res.field === 'phone') {
      setFieldError({ field: 'phone', text: msg(res.errorKey) ?? codeMsg(res) })
      setStep('phone')
    } else setError(codeMsg(res))
    return null
  }

  const onSubmitPhone = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldError(null)
    const parsed = forgotPasswordSchema.safeParse({ phone })
    if (!parsed.success) {
      setFieldError({ field: 'phone', text: msg(parsed.error.issues[0].message) ?? '' })
      return
    }
    setBusy(true)
    const next = await request()
    setBusy(false)
    if (next !== null) {
      setResendSeconds(next)
      setStep('code')
    }
  }

  const onSubmitReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFieldError(null)
    const res = await resetPasswordWithCodeAction({ phone, code, password, confirmPassword })
    setBusy(false)
    if (res.ok) {
      setStep('done')
      return
    }
    if (res.field === 'code' || !res.field) {
      setCode('')
      setError(codeMsg(res))
    } else {
      setFieldError({ field: res.field, text: msg(res.errorKey) ?? codeMsg(res) })
    }
  }

  const onSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldError(null)
    const parsed = forgotPasswordEmailSchema.safeParse({ email })
    if (!parsed.success) {
      setFieldError({ field: 'email', text: msg(parsed.error.issues[0].message) ?? '' })
      return
    }
    setBusy(true)
    await forgotPasswordByEmailAction({ email })
    setBusy(false)
    setStep('emailSent')
  }

  const back = (
    <Link
      href="/login"
      className="mt-5 inline-flex w-full items-center justify-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {t('backToLogin')}
    </Link>
  )

  const errFor = (field: string) => (fieldError?.field === field ? fieldError.text : undefined)

  if (step === 'done') {
    return (
      <div className="text-center">
        <FormHeader icon={<CheckCircle2 />} title={t('doneTitle')} subtitle={t('doneSubtitle')} className="mb-6" />
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-(--radius-input) bg-brand-600 px-4 py-3 text-[0.9375rem] font-semibold text-white hover:bg-brand-700"
        >
          {t('logIn')}
        </Link>
      </div>
    )
  }

  if (step === 'emailSent') {
    return (
      <div className="text-center">
        <FormHeader
          icon={<Mail />}
          title={t('sentTitle')}
          subtitle={t.rich('sentSubtitle', {
            email,
            em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
          })}
          className="mb-6"
        />
        {back}
      </div>
    )
  }

  if (step === 'email') {
    return (
      <div>
        <FormHeader icon={<Mail />} title={t('emailTitle')} subtitle={t('emailSubtitle')} />
        <form method="post" onSubmit={onSubmitEmail} noValidate className="flex flex-col gap-3.5">
          <TextField
            label={t('email')}
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            leadingIcon={<Mail />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errFor('email')}
          />
          <Button type="submit" size="lg" fullWidth loading={busy} className="mt-1.5">
            {t('emailSubmit')}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => setStep('phone')}
          className="mt-4 w-full text-center text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
        >
          {t('usePhone')}
        </button>
        {back}
      </div>
    )
  }

  if (step === 'code') {
    return (
      <div>
        <FormHeader icon={<KeyRound />} title={t('codeTitle')} subtitle={t('codeSubtitle')} />
        <form method="post" onSubmit={onSubmitReset} noValidate className="flex flex-col gap-4">
          <SmsCodeStep
            phone={phone}
            value={code}
            onChange={(v) => {
              setCode(v)
              setError(null)
            }}
            onResend={request}
            resendSeconds={resendSeconds}
            error={error}
            disabled={busy}
          />
          <PasswordField
            label={t('newPassword')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errFor('password')}
          />
          <PasswordField
            label={t('confirmPassword')}
            autoComplete="new-password"
            showChecklist={false}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={errFor('confirmPassword')}
          />
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={busy}
            disabled={code.length < 6 || !password || !confirmPassword}
          >
            {t('resetSubmit')}
          </Button>
        </form>
        {back}
      </div>
    )
  }

  return (
    <div>
      <FormHeader icon={<KeyRound />} title={t('title')} subtitle={t('subtitle')} />

      <form method="post" onSubmit={onSubmitPhone} noValidate className="flex flex-col gap-3.5">
        <TextField
          label={t('phone')}
          type="tel"
          inputMode="tel"
          placeholder="024 123 4567"
          autoComplete="tel-national"
          autoFocus
          leadingIcon={<Phone />}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setFieldError(null)
          }}
          error={errFor('phone')}
        />
        {error && (
          <p role="alert" className="text-[0.8125rem] font-medium text-danger-600">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={busy} className="mt-1.5">
          {t('submit')}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setStep('email')
          setFieldError(null)
          setError(null)
        }}
        className="mt-4 w-full text-center text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
      >
        {t('useEmail')}
      </button>
      {back}
    </div>
  )
}
