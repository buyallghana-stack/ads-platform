'use client'

import { useEffect, useState } from 'react'

import { AlertTriangle, Mail } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { resendConfirmationAction } from '@/app/[locale]/(auth)/actions'
import { Link } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'

const RESEND_COOLDOWN_SECONDS = 60

/**
 * "Check your email" — the whole of email verification on this side.
 *
 * It used to be three steps ending in a six-digit code box. The operator's
 * direction (2026-07-25) is that these emails are LINKS, so there is nothing
 * to type: the person clicks the link, /auth/confirm redeems the token and
 * signs them in. That is also the safer arrangement — a code is something a
 * user can be talked into reading out to somebody claiming to be support, and
 * a link they click themselves cannot be.
 *
 * All this screen does is say where to look and let them ask for another. The
 * cooldown is a courtesy against honest double-tapping; the real rate limit is
 * Supabase's, server-side (§2.4).
 */
export function VerifyFlow({
  email,
  linkError,
}: {
  email: string
  /** Set when somebody arrives back here from a link that did not work:
   *  'expired' — already used, or too old; 'link' — arrived without a token. */
  linkError?: 'expired' | 'link'
}) {
  const t = useTranslations('auth.verify')
  const tError = useTranslations('auth.errors')
  const msg = useAuthErrorMessage()

  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [resendIn])

  const resend = async () => {
    setSending(true)
    setError(null)
    const result = await resendConfirmationAction(email)
    setSending(false)

    if (!result.ok) {
      setError(msg(result.errorKey) ?? tError('generic'))
      return
    }
    setResent(true)
    setResendIn(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <div className="text-center">
      <FormHeader
        icon={<Mail />}
        title={t('checkEmail.title')}
        subtitle={t.rich('checkEmail.subtitle', {
          email,
          // A tag pair, not an element-as-value. next-intl types placeholder
          // values as string | number | Date, and returning an unkeyed array
          // from t.rich also tripped React's missing-key warning. Tags solve
          // both: the value stays a string, the styling is a tag function.
          em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
        })}
        className="mb-5"
      />

      {/* A link that failed is the one thing worth interrupting for. Without
          this the screen looks identical to a fresh arrival, and the person
          goes back to their inbox and clicks the same dead link again. */}
      {linkError && (
        <div
          role="alert"
          className="mb-5 flex gap-2.5 rounded-(--radius-input) border border-warning-500/25 bg-warning-50 px-3.5 py-3 text-left text-[0.8125rem] text-warning-600"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="leading-relaxed">
            {t(linkError === 'expired' ? 'linkExpired' : 'linkInvalid')}
          </span>
        </div>
      )}

      <p className="mb-6 text-[0.8125rem] leading-relaxed text-ink-500">{t('checkEmail.hint')}</p>

      <Button
        size="lg"
        fullWidth
        onClick={() => void resend()}
        loading={sending}
        disabled={resendIn > 0}
      >
        {resendIn > 0 ? t('resendIn', { seconds: resendIn }) : t('resend')}
      </Button>

      {resent && !error && (
        <p role="status" className="mt-3 text-[0.8125rem] font-medium text-success-700">
          {t('resent')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}

      <p className="mt-6 text-center text-[0.8125rem] text-ink-500">
        {t('wrongEmail')}{' '}
        <Link href="/signup" className="font-medium text-ink-900 hover:text-brand-700">
          {t('changeEmail')}
        </Link>
      </p>
    </div>
  )
}
