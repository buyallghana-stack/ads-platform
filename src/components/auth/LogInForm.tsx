'use client'

import { useEffect, useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { logInAction } from '@/app/[locale]/(auth)/actions'
import { deviceFingerprint, warmFingerprint } from '@/lib/fraud/fingerprint'
import { Link, useRouter } from '@/i18n/navigation'
import { logInSchema, type LogInInput } from '@/lib/validation/auth'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'

export function LogInForm() {
  const t = useTranslations('auth.logIn')
  const tError = useTranslations('auth.errors')
  const router = useRouter()
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

  // Fetches and computes the device signature while the form is being filled,
  // so submitting does not wait on a download. See `warmFingerprint`.
  useEffect(() => {
    warmFingerprint()
  }, [])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    const result = await logInAction({
      email: values.email,
      password: values.password,
      fingerprint: await deviceFingerprint(),
    })

    if (result.ok) {
      /*
       * Client-side navigation, not a full document reload. The login page has
       * already downloaded the framework and React, so moving to the dashboard
       * only streams its RSC payload — near-instant, and the dashboard's
       * loading.tsx shows a skeleton immediately, instead of the 10-15s blank
       * a full reload cost on slow mobile (reported 2026-07-24).
       *
       * This was briefly a window.location.assign to dodge a "stuck on login"
       * bug — but that bug was the iOS 15 hydration CRASH (fixed by the
       * browserslist transpile), not the client transition. With JS running,
       * router.replace is reliable, and the /login session guard remains the
       * safety net if any transition is ever dropped.
       *
       * refresh() drops the cached Server Component tree so the dashboard
       * renders against the just-established session, not a signed-out cache.
       */
      router.replace(result.redirectTo ?? '/dashboard')
      router.refresh()
      return
    }

    // An unverified account is not a failed login — send them to finish
    // verifying rather than showing an error they cannot act on.
    if (result.errorKey === 'emailNotVerified') {
      router.push(`/verify?email=${encodeURIComponent(values.email)}`)
      return
    }

    setFormError(result.message ?? msg(result.errorKey) ?? tError('generic'))
  })

  return (
    <div>
      <FormHeader icon={<UserRound />} title={t('title')} subtitle={t('subtitle')} />

      {formError && (
        <div
          role="alert"
          className="mb-5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2.5 text-[0.8125rem] text-danger-700"
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
          leadingIcon={<Mail />}
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

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1.5">
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
