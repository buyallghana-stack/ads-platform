'use client'

import { useEffect, useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarClock, Clock, LogIn, LogOut, Mail, UserRound } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import {
  confirmLoginAndCancelDeletionAction,
  logInAction,
  stayLoggedOutAction,
} from '@/app/[locale]/(auth)/actions'
import { deviceFingerprint, warmFingerprint } from '@/lib/fraud/fingerprint'
import { Link, useRouter } from '@/i18n/navigation'
import { logInSchema, type LogInInput } from '@/lib/validation/auth'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'

export function LogInForm() {
  const t = useTranslations('auth.logIn')
  const tError = useTranslations('auth.errors')
  const router = useRouter()
  const format = useFormatter()
  const msg = useAuthErrorMessage()

  const [formError, setFormError] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [deletionInfo, setDeletionInfo] = useState<{
    requestedAt?: string
    effectiveAt?: string
  } | null>(null)
  const [pendingCredentials, setPendingCredentials] = useState<{
    email: string
    password: string
  } | null>(null)
  const [actionLoading, setActionLoading] = useState<'cancel' | 'stay' | null>(null)

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
    setNoticeMessage(null)

    const result = await logInAction({
      email: values.email,
      password: values.password,
      fingerprint: await deviceFingerprint(),
    })

    if (result.ok) {
      if (result.deletionPending) {
        setPendingCredentials({ email: values.email, password: values.password })
        setDeletionInfo({
          requestedAt: result.requestedAt,
          effectiveAt: result.effectiveAt,
        })
        return
      }

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

  if (deletionInfo) {
    const requestedDateStr = deletionInfo.requestedAt
      ? format.dateTime(new Date(deletionInfo.requestedAt), {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

    const effectiveDateStr = deletionInfo.effectiveAt
      ? format.dateTime(new Date(deletionInfo.effectiveAt), {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

    const handleCancelAndLogin = async () => {
      if (!pendingCredentials) return
      setFormError(null)
      setActionLoading('cancel')
      const res = await confirmLoginAndCancelDeletionAction({
        email: pendingCredentials.email,
        password: pendingCredentials.password,
        fingerprint: await deviceFingerprint(),
      })
      if (res.ok) {
        router.replace(res.redirectTo ?? '/dashboard')
        router.refresh()
      } else {
        setActionLoading(null)
        setFormError(res.message ?? msg(res.errorKey) ?? tError('generic'))
      }
    }

    const handleStayLoggedOut = async () => {
      setActionLoading('stay')
      await stayLoggedOutAction()
      setActionLoading(null)
      setDeletionInfo(null)
      setPendingCredentials(null)
      setNoticeMessage(t('deletionPending.loggedOutNotice'))
    }

    return (
      <div>
        <FormHeader
          icon={<CalendarClock className="text-amber-600 dark:text-amber-400" />}
          title={t('deletionPending.title')}
          subtitle={t('deletionPending.subtitle')}
        />

        {formError && (
          <div
            role="alert"
            className="mb-5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2.5 text-[0.8125rem] text-danger-700 dark:bg-danger-950/40 dark:text-danger-400"
          >
            {formError}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="rounded-(--radius-card) border border-amber-500/30 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-950/25">
            <div className="flex flex-col gap-3">
              {requestedDateStr && (
                <div className="flex items-start gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    <Clock className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.75rem] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      {t('deletionPending.requestedLabel')}
                    </p>
                    <p className="mt-0.5 text-[0.875rem] font-semibold text-ink-900">
                      {requestedDateStr}
                    </p>
                  </div>
                </div>
              )}

              {effectiveDateStr && (
                <div className="flex items-start gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                    <CalendarClock className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.75rem] font-semibold uppercase tracking-wider text-rose-800 dark:text-rose-300">
                      {t('deletionPending.effectiveLabel')}
                    </p>
                    <p className="mt-0.5 text-[0.875rem] font-semibold text-rose-600 dark:text-rose-300">
                      {effectiveDateStr}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <p className="mt-3.5 border-t border-amber-500/20 pt-3 text-[0.8125rem] leading-relaxed text-ink-700">
              {t('deletionPending.warning')}
            </p>
          </div>

          <p className="text-[0.8125rem] leading-relaxed text-ink-700">
            {t('deletionPending.prompt')}
          </p>

          <div className="flex flex-col gap-2.5 pt-2">
            <Button
              type="button"
              size="lg"
              fullWidth
              loading={actionLoading === 'cancel'}
              disabled={actionLoading !== null}
              onClick={handleCancelAndLogin}
              leadingIcon={<LogIn className="size-4" />}
            >
              {t('deletionPending.cancelAndLogin')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              loading={actionLoading === 'stay'}
              disabled={actionLoading !== null}
              onClick={handleStayLoggedOut}
              leadingIcon={<LogOut className="size-4" />}
            >
              {t('deletionPending.stayLoggedOut')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <FormHeader icon={<UserRound />} title={t('title')} subtitle={t('subtitle')} />

      {noticeMessage && (
        <div
          role="status"
          className="mb-5 flex items-start gap-2.5 rounded-(--radius-input) border border-warning-500/30 bg-warning-50 px-3.5 py-3 text-[0.8125rem] text-warning-800 dark:border-warning-500/30 dark:bg-warning-50/20 dark:text-warning-300"
        >
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-warning-600 dark:text-warning-400" />
          <p className="leading-relaxed">{noticeMessage}</p>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="mb-5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2.5 text-[0.8125rem] text-danger-700"
        >
          {formError}
        </div>
      )}

      {/* ⚠️ `method="post"` ON A FORM THAT NEVER POSTS. `onSubmit` handles this
          and calls `preventDefault`, so the method is never used... until
          JavaScript has not hydrated yet, or it throws. A form element with no method
          defaults to GET, and a native GET submit puts every field IN THE URL:
          observed on the live site as
          /login?email=...&password=...  which then lands in browser history,
          in the Referer header of the next request, and in the server logs.
          One attribute is the difference between a failed sign-in and a
          credential in a log file. */}
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
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
