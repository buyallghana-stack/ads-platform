'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, KeyRound, Mail } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'

import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { forgotPasswordAction } from '@/app/[locale]/(auth)/actions'
import { Link } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validation/auth'

export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword')
  const msg = useAuthErrorMessage()

  const [sentTo, setSentTo] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async (data) => {
    /*
      Always reports success, whether or not the account exists. Saying "no
      account found" turns this form into a membership oracle — an attacker
      could enumerate registered emails, which on a platform that pays out
      money is exactly the list worth phishing. The copy matches: "if an
      account exists…".
    */
    await forgotPasswordAction({ email: data.email })
    setSentTo(data.email)
  })

  if (sentTo) {
    return (
      <div className="text-center">
        <FormHeader
          icon={<Mail />}
          title={t('sentTitle')}
          subtitle={t.rich('sentSubtitle', {
            email: sentTo,
            em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
          })}
          className="mb-6"
        />
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-600 hover:text-brand-700"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {t('backToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <div>
      <FormHeader icon={<KeyRound />} title={t('title')} subtitle={t('subtitle')} />

      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          leadingIcon={<Mail />}
          error={msg(errors.email?.message)}
          {...register('email')}
        />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1.5">
          {t('submit')}
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-5 inline-flex w-full items-center justify-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {t('backToLogin')}
      </Link>
    </div>
  )
}
