import type { Metadata } from 'next'

import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/Button'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { confirmVaultPaystackReference } from '@/lib/payments/vault-confirm'

export const metadata: Metadata = {
  title: 'Vault Deposit Payment',
  robots: { index: false, follow: false },
}

export default async function VaultPaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ reference?: string; trxref?: string; ref?: string }>
}) {
  const { locale } = await params
  const { reference, trxref, ref } = await searchParams
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('vault.paymentResult')

  const paymentRef = reference ?? trxref ?? ref ?? null
  const outcome = paymentRef ? await confirmVaultPaystackReference(paymentRef) : null

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

        <Link href="/vault" className="mt-7 w-full">
          <Button size="lg" fullWidth>
            {t(`${state}.cta`)}
          </Button>
        </Link>
      </div>
    </div>
  )
}
