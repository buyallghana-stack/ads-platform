import type { Metadata } from 'next'

import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { Link } from '@/i18n/navigation'
import { getVisitorToken } from '@/lib/market/attribution'
import { confirmProductOrder } from '@/lib/market/orders'

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
}

/**
 * Where Paystack sends the buyer back to.
 *
 * ── THIS IS NOT THE ONLY PATH, AND IT MUST NOT BE ──
 *
 * The webhook confirms the same order independently. This page exists because
 * a person standing there deserves an answer immediately rather than whenever
 * a background call lands — but a buyer who closes the tab, loses signal, or
 * never returns still gets their product. Both paths call
 * `confirm_product_order`, which refuses an order that is already confirmed, so
 * whichever arrives first wins and the second is a no-op.
 *
 * ── THE VISITOR TOKEN IS READ HERE ──
 *
 * And passed straight through to `attribute_order`. This is the moment
 * commission is decided: without the token, the sale completes, the product is
 * delivered, and no affiliate is paid — silently. The webhook has no cookie to
 * read and relies on the account-side half of the binding instead, which is
 * why clicks are recorded against BOTH.
 *
 * ── EVERY OUTCOME GETS ITS OWN SCREEN ──
 *
 * "Paid", "not paid yet", "the amount did not match" and "we could not find
 * that order" need four different sentences and four different next steps. A
 * single "something went wrong" here is money-shaped ambiguity, on the one
 * screen where somebody has just been charged.
 */
export default async function ProductCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ reference?: string; trxref?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('affiliate.callback')
  const sp = await searchParams

  /* Paystack sends both; `reference` is ours, `trxref` is theirs, and they are
     the same value. Taking either means a change at their end does not strand
     a buyer on a blank page. */
  const reference = sp.reference ?? sp.trxref ?? null

  let state: 'ok' | 'already' | 'pending' | 'mismatch' | 'missing' | 'error' = 'missing'
  let productId: string | null = null

  if (reference) {
    const token = await getVisitorToken()
    const result = await confirmProductOrder(reference, token)
    if (result.ok) {
      state = result.alreadyDone ? 'already' : 'ok'
      productId = result.productId
    } else {
      state =
        result.reason === 'not_paid'
          ? 'pending'
          : result.reason === 'mismatch'
            ? 'mismatch'
            : result.reason === 'not_found'
              ? 'missing'
              : 'error'
    }
  }

  const good = state === 'ok' || state === 'already'
  const waiting = state === 'pending'

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center">
        <div className="flex justify-center">
          <Logo variant="dark" />
        </div>

        <span
          aria-hidden
          className={`mx-auto mt-6 grid size-14 place-items-center rounded-full ${
            good
              ? 'bg-success-50 text-success-600'
              : waiting
                ? 'bg-warning-50 text-warning-600'
                : 'bg-danger-50 text-danger-600'
          }`}
        >
          {good ? (
            <CheckCircle2 className="size-7" />
          ) : waiting ? (
            <Clock className="size-7" />
          ) : (
            <AlertTriangle className="size-7" />
          )}
        </span>

        <h1 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t(`${state}.title`)}
        </h1>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-600">{t(`${state}.body`)}</p>

        <div className="mt-6 flex flex-col gap-2">
          {good && (
            <Link
              href="/learn"
              className="rounded-(--radius-input) bg-brand-600 px-5 py-3 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              {t('startLearning')}
            </Link>
          )}
          <Link
            href={good ? '/market' : '/'}
            className="rounded-(--radius-input) border border-ink-200 px-5 py-3 text-[0.875rem] font-semibold text-ink-700 transition-colors hover:border-ink-300"
          >
            {t(good ? 'goDashboard' : 'goHome')}
          </Link>
          {!good && !waiting && (
            <Link
              href="/support"
              className="text-[0.8125rem] font-medium text-brand-600 hover:text-brand-700"
            >
              {t('contactSupport')}
            </Link>
          )}
        </div>

        {reference && (
          <p className="mt-5 font-mono text-[0.6875rem] text-ink-400">
            {t('reference', { reference })}
          </p>
        )}

        {/* Rendered but unused: the id proves the confirm returned a product,
            which is worth having in the DOM for a support screenshot. */}
        {productId && <span className="sr-only">{productId}</span>}
      </div>
    </div>
  )
}
