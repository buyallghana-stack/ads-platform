'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { Button } from '@/components/ui/Button'
import { PasswordField } from '@/components/ui/PasswordField'
import { Link } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'
import { resetPasswordSchema, type ResetPasswordInput } from '@/lib/validation/auth'

export function ResetPasswordForm() {
  const t = useTranslations('auth.resetPassword')
  const tLogIn = useTranslations('auth.logIn')
  const tError = useTranslations('auth.errors')
  const msg = useAuthErrorMessage()

  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  })

  const password = watch('password') ?? ''
  const confirmPassword = watch('confirmPassword') ?? ''

  const onSubmit = handleSubmit(async () => {
    setFormError(null)
    // Server action lands with the auth wiring.
    await new Promise((r) => setTimeout(r, 400))
    setFormError(tError('generic'))
  })

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full border border-success-500/25 bg-success-50 text-success-600">
          <CheckCircle2 aria-hidden className="size-5" />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {t('successTitle')}
        </h2>
        <p className="mt-1.5 text-[0.8125rem] text-ink-500">{t('successSubtitle')}</p>
        <Link href="/login" className="mt-6 block">
          <Button fullWidth>{tLogIn('submit')}</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-6">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h2>
        <p className="mt-1 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {formError && (
        <div
          role="alert"
          className="mb-5 rounded-[--radius-input] border border-danger-500/25 bg-danger-50 px-3 py-2.5 text-[0.8125rem] text-danger-700"
        >
          {formError}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <PasswordField
              label={t('newPassword')}
              autoComplete="new-password"
              autoFocus
              value={password}
              error={msg(errors.password?.message)}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
            />
          )}
        />

        <Controller
          control={control}
          name="confirmPassword"
          render={({ field }) => (
            <PasswordField
              label={t('confirmPassword')}
              autoComplete="new-password"
              // The rules are already shown above; repeating them here would
              // be noise.
              showChecklist={false}
              value={confirmPassword}
              error={msg(errors.confirmPassword?.message)}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
            />
          )}
        />

        <Button type="submit" fullWidth loading={isSubmitting} className="mt-1.5">
          {t('submit')}
        </Button>
      </form>
    </div>
  )
}
