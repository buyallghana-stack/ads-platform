'use client'

import { useState } from 'react'

import { LogOut, Phone, Smartphone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { FormHeader } from '@/components/auth/FormHeader'
import { SmsCodeStep, useCodeErrorMessage } from '@/components/auth/SmsCodeStep'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { logOutAction } from '@/app/[locale]/(auth)/actions'
import { confirmPhoneAction, sendPhoneCodeAction } from '@/app/[locale]/(auth)/verify-phone/actions'
import { useRouter } from '@/i18n/navigation'

/**
 * "Confirm your phone number": the screen every account without a verified
 * phone is held on. Number first (prefilled with whatever the profile already
 * had, which was never proved), then the code.
 */
export function VerifyPhoneForm({ defaultPhone }: { defaultPhone: string }) {
  const t = useTranslations('auth.verifyPhone')
  const tError = useTranslations('auth.errors')
  const errText = useCodeErrorMessage()
  const router = useRouter()

  const [phone, setPhone] = useState(defaultPhone)
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [code, setCode] = useState('')
  const [resendSeconds, setResendSeconds] = useState(60)
  const [error, setError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (): Promise<number | null> => {
    setError(null)
    setPhoneError(null)
    const res = await sendPhoneCodeAction({ phone })
    if (!res.ok) {
      if (res.redirectTo) router.replace(res.redirectTo)
      const text = errText(res)
      if (res.field === 'phone') {
        setPhoneError(text)
        setStep('phone')
      } else setError(text)
      return null
    }
    if ('codeSent' in res) return res.resendSeconds
    return 60
  }

  const onSubmitPhone = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const next = await send()
    setBusy(false)
    if (next !== null) {
      setResendSeconds(next)
      setCode('')
      setStep('code')
    }
  }

  const confirm = async (value: string) => {
    setBusy(true)
    setError(null)
    const res = await confirmPhoneAction({ phone, code: value })
    if (res.ok) {
      router.replace(res.redirectTo ?? '/dashboard')
      router.refresh()
      return
    }
    setBusy(false)
    setCode('')
    if (res.field === 'phone') {
      setPhoneError(errText(res))
      setStep('phone')
      return
    }
    setError(errText(res))
  }

  const signOut = async () => {
    await logOutAction()
    router.replace('/login')
    router.refresh()
  }

  return (
    <div>
      <FormHeader icon={<Smartphone />} title={t('title')} subtitle={t('subtitle')} />

      {step === 'phone' ? (
        <form method="post" onSubmit={onSubmitPhone} noValidate className="flex flex-col gap-3.5">
          <TextField
            label={t('phone')}
            type="tel"
            inputMode="tel"
            placeholder="024 123 4567"
            autoComplete="tel-national"
            leadingIcon={<Phone />}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setPhoneError(null)
            }}
            hint={t('phoneHint')}
            error={phoneError ?? undefined}
          />
          {error && (
            <p role="alert" className="text-[0.8125rem] font-medium text-danger-600">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={!phone.trim()}>
            {t('send')}
          </Button>
        </form>
      ) : (
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            void confirm(code)
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <SmsCodeStep
            phone={phone}
            value={code}
            onChange={(v) => {
              setCode(v)
              setError(null)
            }}
            onComplete={(v) => void confirm(v)}
            onResend={send}
            resendSeconds={resendSeconds}
            error={error}
            disabled={busy}
          />
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={code.length < 6}>
            {t('confirm')}
          </Button>
          <button
            type="button"
            onClick={() => {
              setStep('phone')
              setError(null)
            }}
            className="text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
          >
            {t('changeNumber')}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-6 inline-flex w-full items-center justify-center gap-1.5 border-t border-ink-100 pt-4 text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
      >
        <LogOut aria-hidden className="size-3.5" />
        {tError('signOutInstead')}
      </button>
    </div>
  )
}
