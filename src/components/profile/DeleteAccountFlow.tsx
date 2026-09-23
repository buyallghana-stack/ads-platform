'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  checkDeletionCode,
  checkDeletionPassword,
  confirmAccountDeletion,
} from '@/app/[locale]/(app)/profile/delete/actions'
import { Button } from '@/components/ui/Button'
import { CodeInput } from '@/components/ui/CodeInput'
import { PasswordField } from '@/components/ui/PasswordField'
import { useRouter } from '@/i18n/navigation'

type Step = 'warning' | 'password' | 'code' | 'phrase'

/**
 * Account deletion, in the operator's order: password, authenticator code,
 * then typing the phrase.
 *
 * Split across steps rather than one long form on purpose. Each screen asks
 * for exactly one thing, so nobody arrives at a single "delete" button with
 * every field already filled — the deliberate pace IS the safety feature, and
 * the phrase is last so it is the final act, not something typed early and
 * forgotten about.
 */
export function DeleteAccountFlow({ needsCode }: { needsCode: boolean }) {
  const t = useTranslations('deleteAccount')
  const tf = useTranslations('twoFactor')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [step, setStep] = useState<Step>('warning')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)

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

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await checkDeletionPassword(password)
      if (!res.ok) return setError(errText(res))
      setStep(needsCode ? 'code' : 'phrase')
    })
  }

  const submitCode = (value: string) => {
    setError(null)
    startTransition(async () => {
      const res = await checkDeletionCode(value)
      if (!res.ok) {
        setCode('')
        return setError(errText(res))
      }
      setStep('phrase')
    })
  }

  const submitPhrase = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await confirmAccountDeletion({ password, code: code || undefined, phrase })
      if (!res.ok) return setError(errText(res))
      // Signed out by the action — a full document load, because the client
      // router would otherwise carry a stale signed-in tree to a public page.
      window.location.assign(
        `/deletion-scheduled?on=${encodeURIComponent(res.effectiveAt)}`,
      )
    })
  }

  const back = () => {
    setError(null)
    if (step === 'warning') return router.push('/profile')
    if (step === 'password') return setStep('warning')
    if (step === 'code') return setStep('password')
    return setStep(needsCode ? 'code' : 'password')
  }

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
          <p className="text-[0.8125rem] text-ink-500">{t('step', { current: stepNumber(step, needsCode), total: needsCode ? 4 : 3 })}</p>
        </div>
      </header>

      {/* 1 — what deletion actually means -------------------------------- */}
      {step === 'warning' && (
        <div className="animate-rise mt-6 flex flex-col gap-4">
          <div className="flex flex-col items-center rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-5 py-7 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-danger-100 text-danger-600">
              <Trash2 aria-hidden className="size-7" />
            </span>
            <h2 className="mt-4 text-[1.0625rem] font-semibold text-danger-700">
              {t('warning.title')}
            </h2>
            <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-danger-700/85">
              {t('warning.body')}
            </p>
          </div>

          <ul className="flex flex-col gap-2.5">
            {['grace', 'cancel', 'noReuse', 'balance'].map((key) => (
              <li
                key={key}
                className="flex items-start gap-2.5 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3"
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-600" />
                <p className="text-[0.8125rem] leading-relaxed text-ink-700">
                  {t(`warning.${key}` as 'warning.grace')}
                </p>
              </li>
            ))}
          </ul>

          <Button variant="danger" size="lg" fullWidth onClick={() => setStep('password')}>
            {t('warning.cta')}
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={() => router.push('/profile')}>
            {t('keepAccount')}
          </Button>
        </div>
      )}

      {/* 2 — password ----------------------------------------------------- */}
      {step === 'password' && (
        <form method="post" onSubmit={submitPassword} className="animate-rise mt-8 flex flex-col">
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('password.title')}</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
            {t('password.body')}
          </p>
          <div className="mt-5">
            <PasswordField
              label={t('password.label')}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              showChecklist={false}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger-600">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            fullWidth
            className="mt-5"
            loading={pending}
            disabled={!password}
          >
            {t('continue')}
          </Button>
        </form>
      )}

      {/* 3 — authenticator code ------------------------------------------- */}
      {step === 'code' && (
        <div className="animate-rise mt-8 flex flex-col items-center">
          <span className="grid size-12 place-items-center rounded-full bg-danger-50 text-danger-600">
            <ShieldAlert aria-hidden className="size-6" />
          </span>
          <h2 className="mt-4 text-[1.0625rem] font-semibold text-ink-900">{t('code.title')}</h2>
          <p className="mt-1.5 max-w-[34ch] text-center text-[0.8125rem] leading-relaxed text-ink-500">
            {t('code.body')}
          </p>
          <div className="mt-6 w-full">
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v)
                setError(null)
              }}
              onComplete={submitCode}
              label={t('code.title')}
              digitLabel={(position) => tf('digit', { position })}
              labelHidden
              disabled={pending}
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-center text-[0.8125rem] font-medium text-danger-600">
              {error}
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            className="mt-5"
            loading={pending}
            disabled={code.length < 6}
            onClick={() => submitCode(code)}
          >
            {t('continue')}
          </Button>
        </div>
      )}

      {/* 4 — type the phrase ---------------------------------------------- */}
      {step === 'phrase' && (
        <form method="post" onSubmit={submitPhrase} className="animate-rise mt-8 flex flex-col">
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{t('phrase.title')}</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
            {t.rich('phrase.body', {
              phrase: (chunks) => (
                <span className="font-semibold text-ink-900">{chunks}</span>
              ),
            })}
          </p>

          <label htmlFor="delete-phrase" className="sr-only">
            {t('phrase.label')}
          </label>
          <input
            id="delete-phrase"
            value={phrase}
            onChange={(e) => {
              setPhrase(e.target.value)
              setError(null)
            }}
            // Autocorrect and capitalisation would fight a phrase that has to
            // be typed exactly.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            placeholder={t('phrase.placeholder')}
            className="mt-5 h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-danger-600 focus:outline-none focus:shadow-[0_0_0_3px] focus:shadow-danger-600/12"
          />

          {error && (
            <p role="alert" className="mt-3 text-[0.8125rem] font-medium text-danger-600">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="danger"
            size="lg"
            fullWidth
            className="mt-5"
            loading={pending}
            disabled={!phrase.trim()}
          >
            {t('phrase.cta')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            fullWidth
            className="mt-2.5"
            onClick={() => router.push('/profile')}
          >
            {t('keepAccount')}
          </Button>
        </form>
      )}
    </div>
  )
}

function stepNumber(step: Step, needsCode: boolean): number {
  if (step === 'warning') return 1
  if (step === 'password') return 2
  if (step === 'code') return 3
  return needsCode ? 4 : 3
}
