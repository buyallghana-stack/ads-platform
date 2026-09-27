'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import { CodeInput } from '@/components/ui/CodeInput'
import { maskPhone } from '@/lib/auth/phone'

/**
 * The code half of every SMS flow: signup, verify phone, forgotten password,
 * change password and change phone. One component so the resend countdown and
 * the error wording cannot drift between five screens.
 *
 * The countdown is a courtesy. The real cooldown and hourly cap are enforced
 * by `otp_issue` in the database.
 */
export function SmsCodeStep({
  phone,
  value,
  onChange,
  onComplete,
  onResend,
  resendSeconds,
  error,
  disabled,
}: {
  phone: string
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  /** Ask for another code. Resolves with the next cooldown, or null if it failed. */
  onResend: () => Promise<number | null>
  /** Seconds before the first resend is allowed. Changing it restarts the timer. */
  resendSeconds: number
  error?: string | null
  disabled?: boolean
}) {
  const t = useTranslations('auth.smsCode')
  const [left, setLeft] = useState(resendSeconds)
  const [sending, setSending] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    if (left <= 0) return
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [left])

  const resend = async () => {
    setSending(true)
    setResent(false)
    const next = await onResend()
    setSending(false)
    if (next !== null) {
      setLeft(next)
      setResent(true)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] leading-relaxed text-ink-600">
        {t.rich('sentTo', {
          phone: maskPhone(phone),
          em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
        })}
      </p>

      <CodeInput
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        label={t('label')}
        digitLabel={(position) => t('digit', { position })}
        labelHidden
        error={error ?? undefined}
        disabled={disabled}
        autoFocus
      />

      <div className="flex items-center justify-between gap-3 text-[0.8125rem]">
        <span className="text-ink-500">{t('notArrived')}</span>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={left > 0 || sending || disabled}
          className="font-medium text-ink-900 hover:text-brand-700 disabled:cursor-default disabled:text-ink-400"
        >
          {left > 0 ? t('resendIn', { seconds: left }) : sending ? t('sending') : t('resend')}
        </button>
      </div>

      {resent && !error && (
        <p role="status" className="text-[0.8125rem] font-medium text-success-700">
          {t('resent')}
        </p>
      )}
    </div>
  )
}

/**
 * Turns a code-flow error into a sentence, filling in minutes and tries left.
 * Falls back to the plain auth error for anything that is not about codes.
 */
export function useCodeErrorMessage() {
  const t = useTranslations('auth.errors')
  return (r: { errorKey?: string; message?: string; retryAfter?: string; attemptsLeft?: number }): string => {
    const minutes = r.retryAfter
      ? Math.max(1, Math.ceil((new Date(r.retryAfter).getTime() - Date.now()) / 60000))
      : 1
    switch (r.errorKey) {
      case 'codeCooldown':
      case 'codeLimit':
        return t(r.errorKey, { minutes })
      case 'codeInvalid':
        return typeof r.attemptsLeft === 'number' ? t('codeInvalidAttempts', { attempts: r.attemptsLeft }) : t('codeInvalid')
    }
    if (r.message) return r.message
    if (!r.errorKey) return t('generic')
    try {
      const value = t(r.errorKey as never)
      return value === r.errorKey ? t('generic') : value
    } catch {
      return t('generic')
    }
  }
}
