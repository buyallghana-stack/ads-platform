'use client'

import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Mail } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'

import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
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
      account found" turns this form into a free membership oracle — an
      attacker can enumerate which emails are registered, which is exactly the
      list worth phishing on a platform that pays out money.

      The copy is worded to match: "if an account exists…".
    */
    await new Promise((r) => setTimeout(r, 400))
    setSentTo(data.email)
  })

  if (sentTo) {
    return (
      <div>
        <span className="grid size-11 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-600">
          <Mail aria-hidden className="size-5" />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {t('sentTitle')}
        </h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-500">
          {t.rich('sentSubtitle', {
            email: sentTo,
            em: (chunks) => <span className="font-medium text-ink-900">{chunks}</span>,
          })}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-600 hover:text-brand-700"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {t('backToLogin')}
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

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          error={msg(errors.email?.message)}
          {...register('email')}
        />
        <Button type="submit" fullWidth loading={isSubmitting} className="mt-1.5">
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
