'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { Link } from '@/i18n/navigation'
import { signUpSchema, type SignUpInput } from '@/lib/validation/auth'

export function SignUpForm() {
  const t = useTranslations('auth.signUp')
  const tError = useTranslations('auth.errors')
  const tCommon = useTranslations('common')

  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    // Validate on blur, then live once a field has errored. Validating on
    // every keystroke from the start shouts at people mid-word.
    mode: 'onTouched',
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      referralCode: '',
      acceptTerms: false as unknown as true,
    },
  })

  const password = watch('password') ?? ''

  /**
   * Schema messages are translation keys, resolved here against the active
   * locale. Falling back to the raw key would show `emailInvalid` to a user,
   * so anything unrecognised degrades to the generic message instead.
   */
  const msg = (key?: string) => {
    if (!key) return undefined
    try {
      const value = tError(key as never)
      return value === key ? tError('generic') : value
    } catch {
      return tError('generic')
    }
  }

  const onSubmit = handleSubmit(async () => {
    setFormError(null)
    // Server action lands in the next commit — the account creation path has to
    // run the fraud checks and referral attribution server-side, and wiring it
    // to a half-built endpoint would look like it works while doing nothing.
    setFormError(tError('generic'))
  })

  return (
    <div>
      <header className="mb-7">
        <h2 className="text-[1.75rem] font-semibold tracking-[-0.025em] text-ink-900">
          {t('title')}
        </h2>
        <p className="mt-1.5 text-[0.9375rem] text-ink-500">{t('subtitle')}</p>
      </header>

      {formError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-[--radius-input] bg-danger-50 p-3.5 text-sm text-danger-700 ring-1 ring-inset ring-danger-500/20"
        >
          <AlertCircle aria-hidden className="mt-px size-4 shrink-0" />
          {formError}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={t('fullName')}
          placeholder={t('fullNamePlaceholder')}
          autoComplete="name"
          error={msg(errors.fullName?.message)}
          {...register('fullName')}
        />

        <TextField
          label={t('email')}
          type="email"
          inputMode="email"
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          error={msg(errors.email?.message)}
          {...register('email')}
        />

        <TextField
          label={t('phone')}
          type="tel"
          inputMode="tel"
          placeholder={t('phonePlaceholder')}
          autoComplete="tel"
          hint={t('phoneHint')}
          error={msg(errors.phone?.message)}
          {...register('phone')}
        />

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <PasswordField
              label={t('password')}
              placeholder={t('passwordPlaceholder')}
              autoComplete="new-password"
              value={password}
              error={msg(errors.password?.message)}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
            />
          )}
        />

        <TextField
          label={t('referralCode')}
          optionalLabel={tCommon('optional')}
          placeholder={t('referralCodePlaceholder')}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={8}
          className="uppercase"
          error={msg(errors.referralCode?.message)}
          {...register('referralCode')}
        />

        <Controller
          control={control}
          name="acceptTerms"
          render={({ field }) => (
            <Checkbox
              className="mt-1"
              checked={Boolean(field.value)}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              name={field.name}
              error={msg(errors.acceptTerms?.message)}
              label={t.rich('terms', {
                terms: (chunks) => (
                  <Link href="/terms" className="font-medium text-brand-700 hover:underline">
                    {chunks}
                  </Link>
                ),
                privacy: (chunks) => (
                  <Link href="/privacy" className="font-medium text-brand-700 hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            />
          )}
        />

        <Button type="submit" fullWidth loading={isSubmitting} className="mt-2">
          {t('submit')}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-ink-500">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">
          {t('logIn')}
        </Link>
      </p>

      <p className="mt-6 text-center text-xs text-ink-400">{t('ghanaOnly')}</p>
    </div>
  )
}
