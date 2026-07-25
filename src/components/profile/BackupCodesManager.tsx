'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, KeyRound, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { regenerateBackupCodes } from '@/app/[locale]/(app)/profile/2fa/actions'
import { BackupCodes } from '@/components/profile/BackupCodes'
import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Backup codes as their own destination, because the Profile hub lists them as
 * their own concern — "how do I get back in" is a different question from "how
 * do I sign in", and a user hunting for it should not have to know it lives
 * inside the 2FA screen.
 *
 * Codes exist only alongside 2FA, so with the factor off this is a signpost
 * rather than a dead end.
 */
export function BackupCodesManager({
  enabled,
  remaining,
  total,
}: {
  enabled: boolean
  remaining: number
  total: number
}) {
  const t = useTranslations('twoFactor')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<'overview' | 'verify' | 'codes'>('overview')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const regenerate = (entered: string) => {
    setError(null)
    startTransition(async () => {
      const res = await regenerateBackupCodes(entered)
      if (!res.ok) {
        setCode('')
        if (res.errorKey === 'locked') {
          const minutes = res.retryAfter
            ? Math.max(1, Math.ceil((new Date(res.retryAfter).getTime() - Date.now()) / 60000))
            : 15
          return setError(t('errors.locked', { minutes }))
        }
        if (res.errorKey === 'wrongCode') {
          return setError(
            typeof res.attemptsLeft === 'number'
              ? t('errors.wrongCodeAttempts', { attempts: res.attemptsLeft })
              : t('errors.wrongCode'),
          )
        }
        return setError(res.message ?? t('errors.generic'))
      }
      setCodes(res.backupCodes)
      setStep('codes')
    })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (step === 'overview' ? router.push('/profile') : setStep('overview'))}
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-4.5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">
            {t('backup.title')}
          </h1>
          <p className="text-[0.8125rem] text-ink-500">{t('backup.subtitle')}</p>
        </div>
      </header>

      {step === 'overview' && (
        <div className="animate-rise mt-6 flex flex-col gap-3">
          {enabled ? (
            <>
              <div
                className={cn(
                  'flex items-start gap-3 rounded-(--radius-card) border px-4 py-3',
                  remaining <= 2
                    ? 'border-warning-500/25 bg-warning-50'
                    : 'border-ink-200 bg-surface',
                )}
              >
                <KeyRound
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-5 shrink-0',
                    remaining <= 2 ? 'text-warning-600' : 'text-ink-500',
                  )}
                />
                <div>
                  <p
                    className={cn(
                      'text-[0.8125rem] font-medium',
                      remaining <= 2 ? 'text-warning-700' : 'text-ink-900',
                    )}
                  >
                    {t('backup.remaining', { remaining, total })}
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 text-[0.75rem] leading-relaxed',
                      remaining <= 2 ? 'text-warning-700/80' : 'text-ink-500',
                    )}
                  >
                    {remaining <= 2 ? t('backup.lowWarning') : t('backup.hint')}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setCode(''); setError(null); setStep('verify') }}
                className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 text-left transition-colors hover:bg-ink-50"
              >
                <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-600">
                  <RefreshCw aria-hidden className="size-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.875rem] font-medium text-ink-900">
                    {t('backup.regenerate')}
                  </span>
                  <span className="block text-[0.75rem] leading-snug text-ink-500">
                    {t('backup.regenerateHint')}
                  </span>
                </span>
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center rounded-(--radius-card) border border-ink-200 bg-surface px-5 py-7 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-ink-100 text-ink-500">
                  <ShieldAlert aria-hidden className="size-7" />
                </span>
                <h2 className="mt-4 text-[1.0625rem] font-semibold text-ink-900">
                  {t('backup.offTitle')}
                </h2>
                <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-ink-500">
                  {t('backup.offBody')}
                </p>
              </div>
              <Button size="lg" fullWidth onClick={() => router.push('/profile/2fa')}>
                {t('backup.offCta')}
              </Button>
            </>
          )}
        </div>
      )}

      {step === 'verify' && (
        <div className="animate-rise mt-8 flex flex-col items-center">
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('regen.title')}</h2>
          <p className="mt-1.5 max-w-[34ch] text-center text-[0.8125rem] leading-relaxed text-ink-500">
            {t('regen.body')}
          </p>
          <div className="mt-6 w-full">
            <CodeInput
              value={code}
              onChange={(v) => { setCode(v); setError(null) }}
              onComplete={regenerate}
              label={t('regen.title')}
              digitLabel={(position) => t('digit', { position })}
              labelHidden
              disabled={pending}
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-center text-[0.75rem] font-medium text-danger-600">
              {error}
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            className="mt-5"
            loading={pending}
            disabled={code.length < 6}
            onClick={() => regenerate(code)}
          >
            {t('regen.cta')}
          </Button>
        </div>
      )}

      {step === 'codes' && (
        <>
          <h2 className="mt-6 text-[1.0625rem] font-semibold text-ink-900">{t('codes.title')}</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{t('codes.replaced')}</p>
          <BackupCodes
            codes={codes}
            doneLabel={t('codes.done')}
            onDone={() => {
              setCodes([])
              setStep('overview')
              router.refresh()
            }}
          />
        </>
      )}
    </div>
  )
}
