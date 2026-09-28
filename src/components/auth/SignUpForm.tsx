'use client'

import { useEffect, useRef, useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Lock, Phone, Ticket, UserRound, UserRoundPlus } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Controller, useForm } from 'react-hook-form'

import { FormHeader } from '@/components/auth/FormHeader'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'
import { completeSignUpAction, startSignUpAction } from '@/app/[locale]/(auth)/actions'
import { SmsCodeStep, useCodeErrorMessage } from '@/components/auth/SmsCodeStep'
import { TurnstileWidget } from '@/components/auth/TurnstileWidget'
import { deviceFingerprint, warmFingerprint } from '@/lib/fraud/fingerprint'
import { getPathname, Link } from '@/i18n/navigation'
import { useAuthErrorMessage } from '@/lib/useAuthErrorMessage'
import { signUpSchema, type SignUpInput } from '@/lib/validation/auth'

/**
 * Signup in two steps. The form, then the code texted to the number. The
 * account is only made once the code comes back, so nobody can park an
 * unproved account on somebody else's phone. The form values stay in this
 * component between the steps; nothing is held on the server.
 */
export function SignUpForm() {
  const t = useTranslations('auth.signUp')
  const tCommon = useTranslations('common')

  const locale = useLocale()
  const msg = useAuthErrorMessage()
  const codeMsg = useCodeErrorMessage()

  const [step, setStep] = useState<'form' | 'code'>('form')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [resendSeconds, setResendSeconds] = useState(60)
  const [completing, setCompleting] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)
  // True when the referral code arrived via an invite link (?ref=) or a
  // previous visit's stored invite — the field is then read-only.
  const [refLocked, setRefLocked] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    // Validate on blur, then live once a field has errored. Validating from
    // the first keystroke shouts at people mid-word.
    mode: 'onTouched',
    defaultValues: {
      fullName: '',
      phone: '',
      password: '',
      referralCode: '',
      acceptTerms: false as unknown as true,
    },
  })

  const password = watch('password') ?? ''

  /*
   * Invite-link referral (operator spec 2026-07-24): /signup?ref=CODE
   * auto-fills the code, locks the field, and SURVIVES refresh — the code is
   * persisted the moment the link is opened, so losing the query string
   * (refresh, back-forward, retyping the URL) loses nothing. A newer invite
   * link overwrites an older stored one; the invitee's latest tap wins.
   *
   * Read via window.location in an effect rather than useSearchParams():
   * the page stays fully static, and there is no Suspense boundary to
   * mis-handle on old WebViews. localStorage access is wrapped — Safari
   * private mode throws on setItem, and the URL path must keep working there.
   */
  useEffect(() => {
    const KEY = 'adreward.ref'
    const VALID = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/
    let code: string | null = null
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase()
      if (fromUrl && VALID.test(fromUrl)) {
        code = fromUrl
        try {
          localStorage.setItem(KEY, fromUrl)
        } catch {
          /* storage unavailable — the URL still fills this visit */
        }
      } else {
        const stored = localStorage.getItem(KEY)
        if (stored && VALID.test(stored)) code = stored
      }
    } catch {
      /* URLSearchParams/localStorage missing on some ancient WebViews */
    }
    if (code) {
      setValue('referralCode', code, { shouldValidate: false })
      setRefLocked(true)
    }
  }, [setValue])

  // Fetches and computes the device signature while the form is being filled,
  // so submitting does not wait on a download. See `warmFingerprint`.
  useEffect(() => {
    warmFingerprint()
  }, [])

  /* Undefined until the challenge solves, or when no site key is configured
     and the widget renders nothing at all. The SERVER decides whether it was
     required — a client that simply omits it must not be able to opt out. */
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>(undefined)

  /* Bumped after every failed submit so the challenge issues a FRESH token.
     Without this the form dies on its first error: the attempt spent the
     token, the widget still reads "Success", and every retry is refused as a
     duplicate until the page is reloaded. Reported from production. */
  const [turnstileReset, setTurnstileReset] = useState(0)

  /* Whether a bot check is even in play. Read once from the same env value the
     widget uses, so the button and the widget can never disagree. */
  const botCheckOn = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)

  /*
    THE CHALLENGE MUST NEVER BE ABLE TO LOCK THE FORM SHUT. If the Cloudflare
    script is blocked or the network drops it, no token ever arrives — so
    waiting for one forever would leave somebody staring at a dead button with
    nothing explaining it. After this long the button comes back and the server
    gives them a real answer, which is the one that can name an ad blocker.

    Set from a timer rather than synchronously in the effect, so this does not
    trip react-hooks/set-state-in-effect; comparing against the reset counter
    is what clears it when the challenge runs again.
  */
  const [stalledAt, setStalledAt] = useState<number | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setStalledAt(turnstileReset), 12_000)
    return () => clearTimeout(id)
  }, [turnstileReset])

  /* After a reset the challenge takes about a second to solve again. Pressing
     the button inside that second sends no token and earns a SECOND error
     about not being a person, on top of whatever actually went wrong — which
     is precisely what the operator hit. So the button waits for it, but only
     for as long as waiting is honest. */
  const awaitingCheck = botCheckOn && !turnstileToken && stalledAt !== turnstileReset

  const fields = async (values: SignUpInput) => ({
    fullName: values.fullName,
    phone: values.phone,
    password: values.password,
    referralCode: values.referralCode || undefined,
    acceptTerms: true,
    /* Awaited rather than fired alongside, because the signal is worth
       nothing if it arrives after the account. It cannot hang the form:
       `deviceFingerprint` resolves to undefined on its own timeout. */
    fingerprint: await deviceFingerprint(),
    turnstileToken: turnstileToken ?? undefined,
  })

  /*
    A server action that THROWS (a dropped connection, a crash, or a page left
    open across a deploy, whose action ids no longer exist on the server) used
    to vanish: the button stopped spinning and nothing else happened. Reported
    from production 2026-09-28. A stale page is fixed by loading it again;
    anything else gets the generic message, at the top of the form, scrolled to.
  */
  const actionFailed = (error: unknown) => {
    if (error instanceof Error && /Server Action/i.test(error.message)) {
      window.location.reload()
      return
    }
    showFormError(codeMsg({ errorKey: 'generic' }))
  }

  const bannerRef = useRef<HTMLDivElement>(null)
  const showFormError = (text: string) => {
    setFormError(text)
    // The banner sits above the first field, off screen on a phone by the
    // time anyone reaches the button.
    requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  // One code check at a time: six digits auto-submit, and the button can fire again.
  const completing_ = useRef(false)

  /** Step 1, and also "send another code": the same checks, a fresh bot token. */
  const requestCode = async (values: SignUpInput): Promise<number | null> => {
    let result: Awaited<ReturnType<typeof startSignUpAction>>
    try {
      result = await startSignUpAction(await fields(values))
    } catch (error) {
      setTurnstileToken(undefined)
      setTurnstileReset((n) => n + 1)
      if (step === 'code') setCodeError(codeMsg({ errorKey: 'generic' }))
      else actionFailed(error)
      return null
    }
    /* The attempt reached the server, so the token it carried is spent
       whatever happened. Ask for a new one now, before the next press. */
    setTurnstileToken(undefined)
    setTurnstileReset((n) => n + 1)
    if (result.ok) return 'codeSent' in result ? result.resendSeconds : 60
    if (step === 'code' && !result.field) {
      setCodeError(codeMsg(result))
      return null
    }
    setStep('form')
    // Field problems belong on the field, so nobody hunts for which input is
    // wrong; the rest goes to the banner. Some checks (a fraud block) return
    // copy the server already phrased.
    if (result.field) {
      setError(result.field as keyof SignUpInput, { message: result.errorKey || 'generic' })
    } else {
      showFormError(result.message ?? codeMsg(result))
    }
    return null
  }

  const complete = async (value: string) => {
    if (completing_.current) return
    completing_.current = true
    setCompleting(true)
    setCodeError(null)
    let result: Awaited<ReturnType<typeof completeSignUpAction>>
    try {
      result = await completeSignUpAction({ ...(await fields(getValues())), code: value })
    } catch (error) {
      completing_.current = false
      setCompleting(false)
      if (error instanceof Error && /Server Action/i.test(error.message)) window.location.reload()
      else setCodeError(codeMsg({ errorKey: 'generic' }))
      return
    }
    if (result.ok) {
      // A full page load, as on /verify-phone: the client transition out of
      // the auth screens stalled on production (2026-09-28).
      window.location.replace(getPathname({ href: result.redirectTo ?? '/dashboard', locale }))
      return
    }
    completing_.current = false
    setCompleting(false)
    setCode('')
    if (result.field && result.field !== 'code') {
      setStep('form')
      setError(result.field as keyof SignUpInput, { message: result.errorKey || 'generic' })
      return
    }
    setCodeError(codeMsg(result))
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    const next = await requestCode(values)
    if (next !== null) {
      setResendSeconds(next)
      setCode('')
      setCodeError(null)
      setStep('code')
    }
  })

  if (step === 'code') {
    return (
      <div>
        <FormHeader icon={<Phone />} title={t('codeTitle')} subtitle={t('codeSubtitle')} />
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault()
            void complete(code)
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <SmsCodeStep
            phone={getValues('phone')}
            value={code}
            onChange={(v) => {
              setCode(v)
              setCodeError(null)
            }}
            onComplete={(v) => void complete(v)}
            onResend={() => requestCode(getValues())}
            resendSeconds={resendSeconds}
            error={codeError}
            disabled={completing}
          />
          {/* A resend is a new text to a number, so it passes the bot check again. */}
          <TurnstileWidget
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
            onToken={setTurnstileToken}
            resetSignal={turnstileReset}
          />
          <Button type="submit" size="lg" fullWidth loading={completing} disabled={code.length < 6}>
            {t('codeSubmit')}
          </Button>
          <button
            type="button"
            onClick={() => setStep('form')}
            className="inline-flex items-center justify-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {t('editDetails')}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div>
      <FormHeader icon={<UserRoundPlus />} title={t('title')} subtitle={t('subtitle')} />

      {formError && (
        <div
          ref={bannerRef}
          role="alert"
          className="mb-5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2.5 text-[0.8125rem] text-danger-700"
        >
          {formError}
        </div>
      )}

      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        <TextField
          label={t('fullName')}
          placeholder={t('fullNamePlaceholder')}
          autoComplete="name"
          leadingIcon={<UserRound />}
          error={msg(errors.fullName?.message)}
          {...register('fullName')}
        />

        <TextField
          label={t('phone')}
          type="tel"
          inputMode="tel"
          placeholder={t('phonePlaceholder')}
          autoComplete="tel-national"
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
          optionalLabel={refLocked ? undefined : tCommon('optional')}
          placeholder={t('referralCodePlaceholder')}
          autoCapitalize="characters"
          autoComplete="off"
          leadingIcon={refLocked ? <Lock /> : <Ticket />}
          maxLength={8}
          // A code applied from an invite link is not editable: the invite
          // decided it, and it must not be deletable by accident.
          readOnly={refLocked}
          hint={refLocked ? t('referralApplied') : undefined}
          // On the input, not the wrapper — putting it on the wrapper also
          // shouted the label.
          inputClassName={
            refLocked
              ? 'uppercase tracking-[0.12em] bg-ink-50 text-ink-700 cursor-default'
              : 'uppercase tracking-[0.12em] placeholder:normal-case placeholder:tracking-normal'
          }
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

        {/* Above the button, and rendering nothing at all until the operator
            sets a site key — no empty box and no layout shift meanwhile. */}
        <TurnstileWidget
          siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          onToken={setTurnstileToken}
          resetSignal={turnstileReset}
        />

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={isSubmitting || awaitingCheck}
          disabled={awaitingCheck}
          className="mt-1.5"
        >
          {awaitingCheck ? t('checking') : t('submit')}
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
