'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { Link } from '@/i18n/navigation'
import { logInSchema, type LogInInput } from '@/lib/validation/auth'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'

export function LogInForm() {
  const t = useTranslations('auth.logIn')
  const tError = useTranslations('auth.errors')
  const msg = useAuthErrorMessage()

  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LogInInput>({
    resolver: zodResolver(logInSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', rememberMe: true },
  })

  const password = watch('password') ?? ''

  const onSubmit = handleSubmit(async () => {
    setFormError(null)
    // Server action lands with the auth wiring.
    setFormError(tError('generic'))
  })

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
        <TextField
          label={t('email')}
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          error={msg(errors.email?.message)}
          {...register('email')}
        />

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <PasswordField
              label={t('password')}
              placeholder={t('passwordPlaceholder')}
              autoComplete="current-password"
              // No rule checklist on login: the password either matches what
              // was set or it does not, and listing requirements here only
              // hints at the shape of the stored password.
              showChecklist={false}
              value={password}
              error={msg(errors.password?.message)}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              labelAccessory={
                <Link
                  href="/forgot-password"
                  className="text-[0.75rem] font-medium text-ink-500 hover:text-brand-700"
                >
                  {t('forgotPassword')}
                </Link>
              }
            />
          )}
        />

        <Controller
          control={control}
          name="rememberMe"
          render={({ field }) => (
            <Checkbox
              className="mt-0.5"
              label={t('rememberMe')}
              checked={Boolean(field.value)}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              name={field.name}
            />
          )}
        />

        <Button type="submit" fullWidth loading={isSubmitting} className="mt-1.5">
          {t('submit')}
        </Button>
      </form>

      <p className="mt-5 text-center text-[0.8125rem] text-ink-500">
        {t('noAccount')}{' '}
        <Link href="/signup" className="font-medium text-ink-900 hover:text-brand-700">
          {t('signUp')}
        </Link>
      </p>
    </div>
  )
}
