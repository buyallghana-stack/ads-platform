'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, LockKeyhole } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { resetPasswordAction } from '@/app/[locale]/(auth)/actions'
import { FormHeader } from '@/components/auth/FormHeader'
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
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  })

  const password = watch('password') ?? ''
  const confirmPassword = watch('confirmPassword') ?? ''

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      const result = await resetPasswordAction(values)

      if (!result.ok) {
        // Field-specific problems belong on the field, not in the banner —
        // "that is your current password" above the form reads as though the
        // whole reset is broken.
        if (result.field === 'password' || result.field === 'confirmPassword') {
          setError(result.field, { message: result.errorKey })
          return
        }
        setFormError(result.message ?? msg(result.errorKey) ?? tError('generic'))
        return
      }

      setDone(true)
    } catch {
      // A thrown server action is the network being down, not a rejected
      // password. Saying "something went wrong" would send them looking for a
      // problem with what they typed.
      setFormError(tError('network'))
    }
  })

  if (done) {
    return (
      <div className="text-center">
        <FormHeader
          icon={<CheckCircle2 />}
          tone="success"
          title={t('successTitle')}
          subtitle={t('successSubtitle')}
          className="mb-6"
        />
        <Link href="/login" className="block">
          <Button size="lg" fullWidth>{tLogIn('submit')}</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <FormHeader icon={<LockKeyhole />} title={t('title')} subtitle={t('subtitle')} />

      {formError && (
        <div
          role="alert"
          className="mb-5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2.5 text-[0.8125rem] text-danger-700"
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

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1.5">
          {t('submit')}
        </Button>
      </form>
    </div>
  )
}
