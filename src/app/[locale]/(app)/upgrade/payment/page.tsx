import type { Metadata } from 'next'

import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/Button'
import { Link, redirect } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { confirmPaystackReference } from '@/lib/payments/confirm'

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
}

/**
 * Where Paystack sends the user back to.
 *
 * Confirms on arrival rather than waiting for the webhook, so the plan is
 * usually live before the page finishes rendering. The webhook still runs and
 * is the safety net if this page is never reached.
 *
 * The reference in the URL is not evidence of anything — anyone can type one.
 * confirmPaystackReference asks Paystack directly and checks the amount
 * against our own record before granting a thing.
 */
export default async function PaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ reference?: string; trxref?: string }>
}) {
  const { locale } = await params
  const { reference, trxref } = await searchParams
  setRequestLocale(locale)

  const user = await getSessionUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('upgrade.result')

  // Paystack sends both; they carry the same value.
  const ref = reference ?? trxref ?? null
  const outcome = ref ? await confirmPaystackReference(ref) : null

  const state: 'success' | 'pending' | 'failed' = !outcome
    ? 'failed'
    : outcome.ok
      ? 'success'
      : outcome.reason === 'not_paid'
        ? 'pending'
        : 'failed'

  const tone = {
    success: { Icon: CircleCheck, chip: 'bg-success-50 text-success-600' },
    pending: { Icon: Clock, chip: 'bg-warning-50 text-warning-600' },
    failed: { Icon: CircleAlert, chip: 'bg-danger-50 text-danger-600' },
  }[state]

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5 sm:px-6 md:py-7">
      <div className="animate-rise mt-10 flex flex-col items-center text-center">
        <span className={`grid size-16 place-items-center rounded-full ${tone.chip}`}>
          <tone.Icon aria-hidden className="size-8" />
        </span>

        <h1 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-900">
          {t(`${state}.title`)}
        </h1>
        <p className="mt-1.5 max-w-[34ch] text-[0.8125rem] leading-relaxed text-ink-500">
          {t(`${state}.body`)}
        </p>

        <Link href="/upgrade" className="mt-7 w-full">
          <Button size="lg" fullWidth>
            {t(`${state}.cta`)}
          </Button>
        </Link>

        {state !== 'success' && (
          <Link
            href="/profile"
            className="mt-3 text-[0.8125rem] font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
          >
            {t('help')}
          </Link>
        )}
      </div>
    </div>
  )
}
