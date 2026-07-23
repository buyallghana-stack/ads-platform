'use client'

import { useEffect, useState } from 'react'

import { CheckCircle2, Mail } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { resendCodeAction, verifyCodeAction } from '@/app/[locale]/(auth)/actions'
import { Link, useRouter } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'

type Step = 'check-email' | 'enter-code' | 'success'

const RESEND_COOLDOWN_SECONDS = 60

/**
 * Email verification, all three steps (§6.1).
 *
 * One component rather than three routes: it is a single journey, the steps
 * share state, and a browser back button landing someone on "check your email"
 * after they have already entered a code would be confusing. The URL carries
 * the email so a refresh does not lose it.
 *
 * The resend cooldown is a client-side courtesy, not a control. Rate limiting
 * belongs on the server — this only stops honest users hammering the button
 * (§2.4).
 */
export function VerifyFlow({ email }: { email: string }) {
  const t = useTranslations('auth.verify')
  const tError = useTranslations('auth.errors')
  const router = useRouter()
  const msg = useAuthErrorMessage()

  const [step, setStep] = useState<Step>('check-email')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [resendIn])

  const verify = async (submitted: string) => {
    if (submitted.length !== 6) {
      setError(tError('codeRequired'))
      return
    }
    setSubmitting(true)
    setError(null)

    const result = await verifyCodeAction({ email, code: submitted })
    setSubmitting(false)

    if (result.ok) {
      setStep('success')
      return
    }
    setError(msg(result.errorKey) ?? tError('generic'))
  }

  const resend = async () => {
    setResendIn(RESEND_COOLDOWN_SECONDS)
    const result = await resendCodeAction(email)
    if (result.ok) {
      setResent(true)
      window.setTimeout(() => setResent(false), 5000)
    } else {
      setError(msg(result.errorKey) ?? tError('generic'))
    }
  }

  /* ------------------------------------------------------------------ */
  if (step === 'success') {
    return (
      <div className="text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full border border-success-500/25 bg-success-50 text-success-600">
          <CheckCircle2 aria-hidden className="size-5" />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {t('success.title')}
        </h2>
        <p className="mt-1.5 text-[0.8125rem] text-ink-500">{t('success.subtitle')}</p>
        <Button fullWidth className="mt-6" onClick={() => router.push('/dashboard')}>
          {t('success.continue')}
        </Button>
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  if (step === 'check-email') {
    return (
      <div>
        <span className="grid size-11 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
          <Mail aria-hidden className="size-5" />
        </span>

        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {t('checkEmail.title')}
        </h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
          {t.rich('checkEmail.subtitle', {
            email,
            // A tag pair, not an element-as-value. next-intl types placeholder
            // values as string | number | Date, and returning an unkeyed array
            // from t.rich also tripped React's missing-key warning. Tags solve
            // both: the value stays a string, the styling is a tag function.
            em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
          })}
        </p>

        <Button fullWidth className="mt-6" onClick={() => setStep('enter-code')}>
          {t('enterCode.submit')}
        </Button>

        <p className="mt-4 text-center text-[0.8125rem] text-ink-500">
          {t('enterCode.wrongEmail')}{' '}
          <Link href="/signup" className="font-medium text-ink-900 hover:text-brand-700">
            {t('enterCode.changeEmail')}
          </Link>
        </p>
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-900">
        {t('enterCode.title')}
      </h2>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
        {t.rich('enterCode.subtitle', {
          email,
          // A tag pair, not an element-as-value. next-intl types placeholder
          // values as string | number | Date, and returning an unkeyed array
          // from t.rich also tripped React's missing-key warning. Tags solve
          // both: the value stays a string, the styling is a tag function.
          em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
        })}
      </p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void verify(code)
        }}
        noValidate
      >
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v)
            if (error) setError(null)
          }}
          onComplete={(v) => void verify(v)}
          label={t('enterCode.codeLabel')}
          digitLabel={(position) => t('enterCode.digitLabel', { position })}
          error={error ?? undefined}
          disabled={submitting}
          autoFocus
        />

        <Button type="submit" fullWidth loading={submitting} disabled={code.length !== 6}>
          {t('enterCode.submit')}
        </Button>
      </form>

      <div className="mt-5 text-center">
        {resent && (
          <p role="status" className="mb-2 text-[0.8125rem] text-success-700">
            {t('enterCode.resent')}
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={() => void resend()} disabled={resendIn > 0}>
          {resendIn > 0 ? t('enterCode.resendIn', { seconds: resendIn }) : t('enterCode.resend')}
        </Button>
      </div>
    </div>
  )
}
