'use client'

import { useState, useTransition } from 'react'

import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import {
  beginEnrollment,
  cancelEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  regenerateBackupCodes,
} from '@/app/[locale]/(app)/profile/2fa/actions'
import { BackupCodes } from '@/components/profile/BackupCodes'
import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

type Step = 'overview' | 'scan' | 'verify' | 'codes' | 'regenVerify' | 'disableVerify' | 'off'

/**
 * Two-factor authentication — opt-in TOTP, in the same visual language as the
 * withdrawal PIN screen it sits beside.
 *
 * The enrolment order is deliberate: scan, then PROVE, then hand over backup
 * codes. Issuing codes before the authenticator is verified would hand someone
 * a recovery kit for a factor they never actually managed to add.
 */
export function TwoFactorFlow({
  enabled,
  confirmedAt,
  backupCodesRemaining,
}: {
  enabled: boolean
  confirmedAt: string | null
  backupCodesRemaining: number
}) {
  const t = useTranslations('twoFactor')
  const format = useFormatter()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [step, setStep] = useState<Step>('overview')
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  /** Turn a failed action into one sentence the user can act on. */
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
      return t('errors.locked', { minutes })
    }
    if (r.errorKey === 'wrongCode') {
      return typeof r.attemptsLeft === 'number'
        ? t('errors.wrongCodeAttempts', { attempts: r.attemptsLeft })
        : t('errors.wrongCode')
    }
    if (r.errorKey) return t(`errors.${r.errorKey}` as 'errors.generic')
    return r.message ?? t('errors.generic')
  }

  const reset = () => {
    setCode('')
    setPassword('')
    setUsePassword(false)
    setError(null)
  }

  // -- enrolment ------------------------------------------------------------

  const start = () => {
    setError(null)
    startTransition(async () => {
      const res = await beginEnrollment()
      if (!res.ok) return setError(errText(res))
      setQr(res.qr)
      setSecret(res.secret)
      setStep('scan')
    })
  }

  const confirm = (entered: string) => {
    setError(null)
    startTransition(async () => {
      const res = await confirmEnrollment(entered)
      if (!res.ok) {
        setCode('')
        return setError(errText(res))
      }
      setCodes(res.backupCodes)
      // The secret has served its purpose; do not keep it in component state.
      setSecret(null)
      setQr(null)
      setStep('codes')
    })
  }

  /** Leaving mid-enrolment must not strand a half-set-up factor. */
  const abandon = () => {
    startTransition(async () => {
      await cancelEnrollment()
      reset()
      setQr(null)
      setSecret(null)
      setStep('overview')
      router.refresh()
    })
  }

  // -- regenerate / disable -------------------------------------------------

  const regenerate = (entered: string) => {
    setError(null)
    startTransition(async () => {
      const res = await regenerateBackupCodes(entered)
      if (!res.ok) {
        setCode('')
        return setError(errText(res))
      }
      setCodes(res.backupCodes)
      setStep('codes')
    })
  }

  const turnOff = (entered?: string) => {
    setError(null)
    startTransition(async () => {
      const res = await disableTwoFactor(
        usePassword ? { password } : { code: entered ?? code },
      )
      if (!res.ok) {
        setCode('')
        return setError(errText(res))
      }
      reset()
      setStep('off')
      router.refresh()
    })
  }

  const copySecret = async () => {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const back = () => {
    if (step === 'scan' || step === 'verify') return abandon()
    if (step === 'overview' || step === 'off') return router.push('/profile')
    reset()
    setStep('overview')
  }

  /** Secrets are 32 chars of base32; four-character groups make them readable. */
  const groupedSecret = secret?.replace(/(.{4})/g, '$1 ').trim()

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={back}
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

      {/* Overview ---------------------------------------------------------- */}
      {step === 'overview' && (
        <div className="animate-rise mt-6 flex flex-col gap-3">
          {enabled ? (
            <>
              <div className="flex items-start gap-3 rounded-(--radius-card) border border-success-500/25 bg-success-50 px-4 py-3">
                <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success-600" />
                <div>
                  <p className="text-[0.8125rem] font-medium text-success-700">{t('on.title')}</p>
                  {confirmedAt && (
                    <p className="mt-0.5 text-[0.75rem] text-success-700/80">
                      {t('on.since', {
                        date: format.dateTime(new Date(confirmedAt), {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        }),
                      })}
                    </p>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  'flex items-center gap-3 rounded-(--radius-card) border px-4 py-3',
                  backupCodesRemaining <= 2
                    ? 'border-warning-500/25 bg-warning-50'
                    : 'border-ink-200 bg-surface',
                )}
              >
                <KeyRound
                  aria-hidden
                  className={cn(
                    'size-5 shrink-0',
                    backupCodesRemaining <= 2 ? 'text-warning-600' : 'text-ink-500',
                  )}
                />
                <p
                  className={cn(
                    'text-[0.8125rem]',
                    backupCodesRemaining <= 2 ? 'text-warning-700' : 'text-ink-700',
                  )}
                >
                  {t('on.codesLeft', { count: backupCodesRemaining })}
                </p>
              </div>

              <button
                type="button"
                onClick={() => { reset(); setStep('regenVerify') }}
                className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 text-left transition-colors hover:bg-ink-50"
              >
                <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-600">
                  <RefreshCw aria-hidden className="size-4.5" />
                </span>
                <span className="text-[0.875rem] font-medium text-ink-900">{t('on.regenerate')}</span>
              </button>

              <button
                type="button"
                onClick={() => { reset(); setStep('disableVerify') }}
                className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 text-left transition-colors hover:bg-ink-50"
              >
                <span className="grid size-9 place-items-center rounded-full bg-danger-50 text-danger-600">
                  <ShieldOff aria-hidden className="size-4.5" />
                </span>
                <span className="text-[0.875rem] font-medium text-ink-900">{t('on.turnOff')}</span>
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center rounded-(--radius-card) border border-ink-200 bg-surface px-5 py-7 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-600">
                  <Smartphone aria-hidden className="size-7" />
                </span>
                <h2 className="mt-4 text-[1.0625rem] font-semibold text-ink-900">{t('off.title')}</h2>
                <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-ink-500">
                  {t('off.body')}
                </p>
              </div>
              {error && (
                <p role="alert" className="text-[0.8125rem] font-medium text-danger-600">
                  {error}
                </p>
              )}
              <Button size="lg" fullWidth loading={pending} onClick={start}>
                {t('off.cta')}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Scan -------------------------------------------------------------- */}
      {step === 'scan' && qr && (
        <div className="animate-rise mt-6 flex flex-col items-center">
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('scan.title')}</h2>
          <p className="mt-1.5 max-w-[34ch] text-center text-[0.8125rem] leading-relaxed text-ink-500">
            {t('scan.body')}
          </p>

          {/* Always on white: a themed background behind a QR breaks scanning. */}
          <div className="mt-5 rounded-(--radius-card) border border-ink-200 bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={t('scan.qrAlt')} width={240} height={240} className="size-[240px]" />
          </div>

          <p className="mt-5 text-[0.75rem] font-medium text-ink-500">{t('scan.manual')}</p>
          <button
            type="button"
            onClick={copySecret}
            className="mt-1.5 flex items-center gap-2 rounded-(--radius-input) border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[0.8125rem] tracking-[0.06em] text-ink-800 transition-colors hover:bg-ink-100"
          >
            {groupedSecret}
            {copied ? (
              <Check aria-hidden className="size-3.5 shrink-0 text-success-600" />
            ) : (
              <Copy aria-hidden className="size-3.5 shrink-0 text-ink-500" />
            )}
          </button>

          <Button size="lg" fullWidth className="mt-6" onClick={() => { setError(null); setStep('verify') }}>
            {t('scan.next')}
          </Button>
        </div>
      )}

      {/* Verify (enrolment) ------------------------------------------------ */}
      {step === 'verify' && (
        <CodeStep
          title={t('verify.title')}
          body={t('verify.body')}
          value={code}
          onChange={(v) => { setCode(v); setError(null) }}
          onComplete={confirm}
          error={error}
          pending={pending}
          submitLabel={t('verify.cta')}
          onSubmit={() => confirm(code)}
        />
      )}

      {/* Backup codes ------------------------------------------------------ */}
      {step === 'codes' && (
        <>
          <h2 className="mt-6 text-[1.0625rem] font-semibold text-ink-900">{t('codes.title')}</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{t('codes.body')}</p>
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

      {/* Regenerate: prove possession first -------------------------------- */}
      {step === 'regenVerify' && (
        <CodeStep
          title={t('regen.title')}
          body={t('regen.body')}
          value={code}
          onChange={(v) => { setCode(v); setError(null) }}
          onComplete={regenerate}
          error={error}
          pending={pending}
          submitLabel={t('regen.cta')}
          onSubmit={() => regenerate(code)}
        />
      )}

      {/* Turn off ---------------------------------------------------------- */}
      {step === 'disableVerify' && (
        <div className="animate-rise mt-8 flex flex-col items-center">
          <span className="grid size-12 place-items-center rounded-full bg-danger-50 text-danger-600">
            <ShieldOff aria-hidden className="size-6" />
          </span>
          <h2 className="mt-4 text-[1.0625rem] font-semibold text-ink-900">{t('disable.title')}</h2>
          <p className="mt-1.5 max-w-[34ch] text-center text-[0.8125rem] leading-relaxed text-ink-500">
            {usePassword ? t('disable.bodyPassword') : t('disable.body')}
          </p>

          {usePassword ? (
            <form
              method="post"
              className="mt-5 w-full"
              onSubmit={(e) => { e.preventDefault(); turnOff() }}
            >
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null) }}
                placeholder={t('disable.passwordPlaceholder')}
                className="h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-sm text-ink-900 placeholder:text-ink-400 pointer-coarse:text-base focus:border-brand-600 focus:outline-none focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12"
              />
              {error && (
                <p role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="danger"
                size="lg"
                fullWidth
                className="mt-4"
                loading={pending}
                disabled={!password}
              >
                {t('disable.cta')}
              </Button>
            </form>
          ) : (
            <div className="mt-5 w-full">
              <CodeInput
                value={code}
                onChange={(v) => { setCode(v); setError(null) }}
                onComplete={(v) => turnOff(v)}
                label={t('disable.title')}
                digitLabel={(position) => t('digit', { position })}
                labelHidden
                disabled={pending}
                autoFocus
              />
              {error && (
                <p role="alert" className="mt-3 text-center text-[0.75rem] font-medium text-danger-600">
                  {error}
                </p>
              )}
              <Button
                variant="danger"
                size="lg"
                fullWidth
                className="mt-4"
                loading={pending}
                disabled={code.length < 6}
                onClick={() => turnOff()}
              >
                {t('disable.cta')}
              </Button>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setUsePassword((v) => !v); setError(null); setCode(''); setPassword('') }}
            className="mt-4 text-[0.75rem] font-medium text-ink-500 underline-offset-2 transition-colors hover:text-ink-800 hover:underline"
          >
            {usePassword ? t('disable.useCode') : t('disable.usePassword')}
          </button>
        </div>
      )}

      {/* Turned off -------------------------------------------------------- */}
      {step === 'off' && (
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-ink-100 text-ink-500">
            <ShieldOff aria-hidden className="size-8" />
          </span>
          <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">{t('offDone.title')}</h2>
          <p className="mt-1.5 max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('offDone.body')}
          </p>
          <Button size="lg" fullWidth className="mt-7" onClick={() => router.push('/profile')}>
            {t('offDone.button')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The shared "type your 6-digit code" step. */
function CodeStep({
  title,
  body,
  value,
  onChange,
  onComplete,
  error,
  pending,
  submitLabel,
  onSubmit,
}: {
  title: string
  body: string
  value: string
  onChange: (v: string) => void
  onComplete: (v: string) => void
  error: string | null
  pending: boolean
  submitLabel: string
  onSubmit: () => void
}) {
  const t = useTranslations('twoFactor')

  return (
    <div className="animate-rise mt-8 flex flex-col items-center">
      <h2 className="text-[1.0625rem] font-semibold text-ink-900">{title}</h2>
      <p className="mt-1.5 max-w-[34ch] text-center text-[0.8125rem] leading-relaxed text-ink-500">
        {body}
      </p>

      <div className="mt-6 w-full">
        <CodeInput
          value={value}
          onChange={onChange}
          onComplete={onComplete}
          label={title}
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
        disabled={value.length < 6}
        onClick={onSubmit}
      >
        {submitLabel}
      </Button>
    </div>
  )
}
