'use client'

import { useState, useTransition } from 'react'

import { ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  cancelChallenge,
  verifyLoginChallenge,
} from '@/app/[locale]/(auth)/verify-2fa/actions'
import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { useRouter } from '@/i18n/navigation'

/**
 * The second step of signing in on an enrolled account.
 *
 * Deliberately offers the backup-code route in the same breath rather than
 * hiding it behind "having trouble?" — the person who needs it has already
 * lost their phone, and hunting for the escape hatch is the worst moment to
 * add friction. The field widens to accept a XXXX-XXXX code when switched.
 */
export function LoginChallengeForm() {
  const t = useTranslations('twoFactor.challenge')
  const tf = useTranslations('twoFactor')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [code, setCode] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (value: string) => {
    if (!value.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await verifyLoginChallenge({ code: value })
      if (res.ok) {
        router.replace(res.redirectTo)
        router.refresh()
        return
      }
      setCode('')
      setBackupCode('')
      if (res.errorKey === 'locked') {
        const minutes = res.retryAfter
          ? Math.max(1, Math.ceil((new Date(res.retryAfter).getTime() - Date.now()) / 60000))
          : 15
        return setError(tf('errors.locked', { minutes }))
      }
      if (res.errorKey === 'wrongCode') {
        return setError(
          typeof res.attemptsLeft === 'number'
            ? tf('errors.wrongCodeAttempts', { attempts: res.attemptsLeft })
            : tf('errors.wrongCode'),
        )
      }
      setError(tf('errors.generic'))
    })
  }

  const signOut = () =>
    startTransition(async () => {
      await cancelChallenge()
      router.replace('/login')
      router.refresh()
    })

  return (
    <div className="flex flex-col">
      <FormHeader
        icon={<ShieldCheck aria-hidden className="size-5" />}
        title={t('title')}
        subtitle={useBackup ? t('subtitleBackup') : t('subtitle')}
      />

      {useBackup ? (
        <form
          className="mt-7"
          onSubmit={(e) => {
            e.preventDefault()
            submit(backupCode)
          }}
        >
          <label htmlFor="backup-code" className="text-[0.8125rem] font-medium text-ink-800">
            {t('backupLabel')}
          </label>
          <input
            id="backup-code"
            autoFocus
            autoCapitalize="characters"
            autoComplete="one-time-code"
            value={backupCode}
            onChange={(e) => {
              setBackupCode(e.target.value)
              setError(null)
            }}
            placeholder="XXXX-XXXX"
            className="mt-1.5 h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 font-mono text-sm tracking-[0.08em] text-ink-900 uppercase pointer-coarse:text-base placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 focus:border-brand-600 focus:outline-none focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12"
          />
          {error && (
            <p role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            fullWidth
            className="mt-5"
            loading={pending}
            disabled={!backupCode.trim()}
          >
            {t('cta')}
          </Button>
        </form>
      ) : (
        <div className="mt-7">
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v)
              setError(null)
            }}
            onComplete={submit}
            label={t('codeLabel')}
            digitLabel={(position) => tf('digit', { position })}
            disabled={pending}
            autoFocus
          />
          {error && (
            <p role="alert" className="mt-3 text-[0.75rem] font-medium text-danger-600">
              {error}
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            className="mt-5"
            loading={pending}
            disabled={code.length < 6}
            onClick={() => submit(code)}
          >
            {t('cta')}
          </Button>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-2 text-[0.8125rem]">
        <button
          type="button"
          onClick={() => {
            setUseBackup((v) => !v)
            setError(null)
            setCode('')
            setBackupCode('')
          }}
          className="font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          {useBackup ? t('useApp') : t('useBackup')}
        </button>
        <button
          type="button"
          onClick={signOut}
          className="text-ink-500 underline-offset-2 transition-colors hover:text-ink-800 hover:underline"
        >
          {t('signOut')}
        </button>
      </div>
    </div>
  )
}
