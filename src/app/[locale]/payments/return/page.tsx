import type { Metadata } from 'next'

import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/Button'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { settleFromHub } from '@/lib/payments/hub/resolve'

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
}

/* Nothing here may be cached: two people returning from the bank must not see
   each other's outcome, and the same person reloading must see the newer one. */
export const dynamic = 'force-dynamic'

/**
 * Where the Tech Store hub sends the buyer back to.
 *
 * ⚠️ THIS ADDRESS IS PART OF THE CONTRACT. The hub keeps an allowlist of
 * return URLs and refuses anything else with a 422, a lookalike domain
 * included. It is `https://sideperks.org/payments/return`, so this route
 * cannot be renamed or moved without the store changing its allowlist first.
 *
 * It settles on arrival rather than waiting, so the plan is usually live
 * before the page finishes rendering. The hub's confirm endpoint is still the
 * one that always arrives, and the two race each other on purpose: fulfilment
 * is idempotent, so whoever is first grants the plan and the other is a no-op.
 *
 * The reference in the URL is evidence of nothing. Anyone can type one.
 * `settleFromHub` looks up the row and then ASKS the hub what happened.
 *
 * ⚠️ IT SERVES BOTH PRODUCTS. Vault deposits moved onto the hub on 18 September
 * 2026 and could not be given a return address of their own, because the hub
 * refuses any URL outside its allowlist with a 422. So the settling is shared
 * and only the WORDS differ: `settleFromHub` reports which kind of payment the
 * reference named, and a buyer who locked funds is told about their Vault and
 * sent back to it, never to the plans page.
 */
export default async function HubPaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ reference?: string; trxref?: string }>
}) {
  const { locale } = await params
  const { reference, trxref } = await searchParams
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const ref = reference ?? trxref ?? null
  const settled = ref ? await settleFromHub(ref) : null

  /* An unknown reference has no kind, and the plan wording is the fallback
     because a plan is what almost every payment through here is. */
  const isVault = settled?.kind === 'vault'
  const t = await getTranslations(isVault ? 'vault.paymentResult' : 'upgrade.result')

  /*
    An unknown reference is shown as failed, but a payment we could not reach
    the hub about is shown as PENDING. Telling somebody who has just been
    debited that their payment failed, because a server to server call timed
    out, is the worst thing this page could do.
  */
  const state: 'success' | 'pending' | 'failed' =
    !settled || settled.state === 'unknown'
      ? 'failed'
      : settled.state === 'confirmed'
        ? 'success'
        : settled.state === 'pending'
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

        <Link href={isVault ? '/vault' : '/upgrade'} className="mt-7 w-full">
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
