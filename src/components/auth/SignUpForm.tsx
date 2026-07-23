'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, Phone, Ticket, UserRound, UserRoundPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { signUpAction } from '@/app/[locale]/(auth)/actions'
import { Link, useRouter } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'
import { signUpSchema, type SignUpInput } from '@/lib/validation/auth'

export function SignUpForm() {
  const t = useTranslations('auth.signUp')
  const tError = useTranslations('auth.errors')
  const tCommon = useTranslations('common')

  const router = useRouter()
  const msg = useAuthErrorMessage()

  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    // Validate on blur, then live once a field has errored. Validating from
    // the first keystroke shouts at people mid-word.
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

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    const result = await signUpAction({
      fullName: values.fullName,
      email: values.email,
      phone: values.phone,
      password: values.password,
      referralCode: values.referralCode || undefined,
      acceptTerms: true,
    })

    if (result.ok) {
      router.push(result.redirectTo ?? '/verify')
      return
    }

    // Field-specific problems belong on the field; everything else goes to the
    // banner. A "referral code does not exist" shown at the top of the form
    // leaves people hunting for which input is wrong.
    if (result.field) {
      setError(result.field as keyof SignUpInput, {
        message: result.errorKey || 'generic',
      })
      return
    }

    // Some checks return copy the server already phrased — a fraud block
    // explains itself better than a generic key could.
    setFormError(result.message ?? msg(result.errorKey) ?? tError('generic'))
  })

  return (
    <div>
      <FormHeader icon={<UserRoundPlus />} title={t('title')} subtitle={t('subtitle')} />

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
          label={t('fullName')}
          placeholder={t('fullNamePlaceholder')}
          autoComplete="name"
          leadingIcon={<UserRound />}
          error={msg(errors.fullName?.message)}
          {...register('fullName')}
        />

        <TextField
          label={t('email')}
          type="email"
          inputMode="email"
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          leadingIcon={<Mail />}
          error={msg(errors.email?.message)}
          {...register('email')}
        />

        <TextField
          label={t('phone')}
          type="tel"
          inputMode="tel"
          placeholder={t('phonePlaceholder')}
          autoComplete="tel"
          leadingIcon={<Phone />}
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
          leadingIcon={<Ticket />}
          maxLength={8}
          // On the input, not the wrapper — putting it on the wrapper also
          // shouted the label.
          inputClassName="uppercase tracking-[0.12em] placeholder:normal-case placeholder:tracking-normal"
          error={msg(errors.referralCode?.message)}
          {...register('referralCode')}
        />

        <Controller
          control={control}
          name="acceptTerms"
          render={({ field }) => (
            <Checkbox
              className="mt-0.5"
              checked={Boolean(field.value)}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              name={field.name}
              error={msg(errors.acceptTerms?.message)}
              label={t.rich('terms', {
                terms: (chunks) => (
                  <Link href="/terms" className="text-ink-900 underline underline-offset-2 hover:text-brand-700">
                    {chunks}
                  </Link>
                ),
                privacy: (chunks) => (
                  <Link href="/privacy" className="text-ink-900 underline underline-offset-2 hover:text-brand-700">
                    {chunks}
                  </Link>
                ),
              })}
            />
          )}
        />

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1.5">
          {t('submit')}
        </Button>
      </form>

      <p className="mt-5 text-center text-[0.8125rem] text-ink-500">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-medium text-ink-900 hover:text-brand-700">
          {t('logIn')}
        </Link>
      </p>

      <p className="mt-7 border-t border-ink-100 pt-4 text-center text-[0.6875rem] text-ink-400">
        {t('ghanaOnly')}
      </p>
    </div>
  )
}
