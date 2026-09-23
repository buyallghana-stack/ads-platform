'use client'

import { useState, useTransition } from 'react'

import { ArrowLeft, Check, KeyRound, Lock, ShieldQuestion } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  resetWithdrawalPin,
  setWithdrawalPin,
} from '@/app/[locale]/(app)/profile/pin/actions'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

type Kind = 'set' | 'change' | 'reset'
type Step = 'menu' | 'current' | 'password' | 'new' | 'confirm' | 'done'

/**
 * Withdrawal PIN — set, change (with the current PIN), or reset a forgotten one
 * (re-verifying the account password). A short state machine over the shared
 * PinPad; the PIN never leaves as anything but the four digits the user types,
 * hashed server-side.
 */
export function WithdrawalPinFlow({ hasPin }: { hasPin: boolean }) {
  const t = useTranslations('pin')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [kind, setKind] = useState<Kind>(hasPin ? 'change' : 'set')
  const [step, setStep] = useState<Step>(hasPin ? 'menu' : 'new')
  const [entry, setEntry] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const errText = (r: { errorKey?: string; message?: string }) =>
    r.message ?? (r.errorKey ? t(`errors.${r.errorKey}` as 'errors.generic') : t('errors.generic'))

  const submit = (finalPin: string) => {
    startTransition(async () => {
      const res =
        kind === 'set'
          ? await setWithdrawalPin({ newPin: finalPin })
          : kind === 'change'
            ? await setWithdrawalPin({ newPin: finalPin, currentPin })
            : await resetWithdrawalPin({ password, newPin: finalPin })

      if (res.ok) {
        setStep('done')
        return
      }
      // Route the failure back to the step that can fix it.
      if (kind === 'change' && res.errorKey === 'wrongCurrent') {
        setCurrentPin('')
        setEntry('')
        setError(t('errors.wrongCurrent'))
        setStep('current')
      } else if (kind === 'reset' && res.errorKey === 'wrongPassword') {
        setEntry('')
        setError(t('errors.wrongPassword'))
        setStep('password')
      } else {
        setEntry('')
        setError(errText(res))
      }
    })
  }

  // Each completed 4-digit entry advances the machine.
  const onPin = (next: string) => {
    setError(null)
    setEntry(next)
    if (next.length < 4) return

    if (step === 'current') {
      setCurrentPin(next)
      setEntry('')
      setStep('new')
    } else if (step === 'new') {
      setFirstPin(next)
      setEntry('')
      setStep('confirm')
    } else if (step === 'confirm') {
      if (next !== firstPin) {
        setEntry('')
        setError(t('errors.mismatch'))
        return
      }
      submit(next)
    }
  }

  const back = () => {
    setError(null)
    setEntry('')
    if (step === 'menu' || step === 'done' || (!hasPin && step === 'new')) {
      router.push('/profile')
    } else if (hasPin) {
      setStep('menu')
    } else {
      router.push('/profile')
    }
  }

  const titles: Record<Exclude<Step, 'menu' | 'done'>, string> = {
    current: t('changeCurrent'),
    password: t('resetPassword'),
    new: kind === 'set' ? t('setNew') : t('chooseNew'),
    confirm: t('confirm'),
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
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
      </header>

      {/* Menu (existing PIN) --------------------------------------------- */}
      {step === 'menu' && (
        <div className="animate-rise mt-6 flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-(--radius-card) border border-success-500/25 bg-success-50 px-4 py-3">
            <ShieldQuestion aria-hidden className="size-5 shrink-0 text-success-600" />
            <p className="text-[0.8125rem] text-success-700">{t('menu.isSet')}</p>
          </div>
          <button
            type="button"
            onClick={() => { setKind('change'); setStep('current') }}
            className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 text-left transition-colors hover:bg-ink-50"
          >
            <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-600">
              <KeyRound aria-hidden className="size-4.5" />
            </span>
            <span className="text-[0.875rem] font-medium text-ink-900">{t('menu.change')}</span>
          </button>
          <button
            type="button"
            onClick={() => { setKind('reset'); setStep('password') }}
            className="flex items-center gap-3 rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5 text-left transition-colors hover:bg-ink-50"
          >
            <span className="grid size-9 place-items-center rounded-full bg-ink-100 text-ink-500">
              <ShieldQuestion aria-hidden className="size-4.5" />
            </span>
            <span className="text-[0.875rem] font-medium text-ink-900">{t('menu.forgot')}</span>
          </button>
        </div>
      )}

      {/* Password step (reset) ------------------------------------------- */}
      {step === 'password' && (
        <form
          method="post"
          className="animate-rise mt-8 flex flex-col items-center"
          onSubmit={(e) => { e.preventDefault(); if (password) setStep('new') }}
        >
          <span className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <Lock aria-hidden className="size-6" />
          </span>
          <h2 className="mt-4 text-[1.0625rem] font-semibold text-ink-900">{t('resetPassword')}</h2>
          <p className="mt-1 max-w-[32ch] text-center text-[0.8125rem] leading-relaxed text-ink-500">
            {t('resetPasswordSub')}
          </p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null) }}
            placeholder={t('resetPasswordPlaceholder')}
            className="mt-5 h-11 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-sm text-ink-900 placeholder:text-ink-400 pointer-coarse:text-base focus:border-brand-600 focus:outline-none focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12"
          />
          {error && <p className="mt-2 self-start text-[0.75rem] font-medium text-danger-600">{error}</p>}
          <Button type="submit" size="lg" fullWidth className="mt-5" disabled={!password}>
            {t('continue')}
          </Button>
        </form>
      )}

      {/* PIN entry steps -------------------------------------------------- */}
      {(step === 'current' || step === 'new' || step === 'confirm') && (
        <div className="animate-rise mt-8 flex flex-col items-center">
          <h2 className="text-[1.0625rem] font-semibold text-ink-900">{titles[step]}</h2>
          <p className="mt-1 h-4 text-[0.8125rem] text-ink-500">
            {step === 'new' && kind === 'set' ? t('setNewSub') : ''}
          </p>
          <div className="mt-6">
            <PinPad value={entry} onChange={onPin} disabled={pending} ariaLabel={titles[step]} />
          </div>
          <p className={cn('mt-4 h-4 text-[0.8125rem] font-medium', error ? 'text-danger-600' : 'text-transparent')}>
            {error ?? '·'}
          </p>
          {pending && <p className="text-[0.8125rem] text-ink-500">{t('saving')}</p>}
        </div>
      )}

      {/* Done ------------------------------------------------------------- */}
      {step === 'done' && (
        <div className="animate-rise mt-10 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-success-50 text-success-600">
            <Check aria-hidden className="size-8" strokeWidth={2.5} />
          </span>
          <h2 className="mt-4 text-[1.25rem] font-semibold text-ink-900">{t('done.title')}</h2>
          <p className="mt-1.5 max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
            {t('done.body')}
          </p>
          <Button size="lg" fullWidth className="mt-7" onClick={() => router.push('/profile')}>
            {t('done.button')}
          </Button>
        </div>
      )}
    </div>
  )
}
