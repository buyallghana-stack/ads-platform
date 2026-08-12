'use client'

import { useState, useTransition } from 'react'

import { Loader2, ShoppingBag } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { previewProductCoupon, startCheckout } from '@/app/[locale]/p/[slug]/actions'
import { CouponField, type AppliedCoupon } from '@/components/checkout/CouponField'
import { cn } from '@/lib/cn'

/**
 * Start checkout.
 *
 * ── DISABLED WHILE IN FLIGHT, AND THAT IS NOT COSMETIC ──
 *
 * Every press creates an order row and a Paystack transaction. A double tap on
 * a slow connection — which is the normal case for this audience — makes two
 * orders for one purchase, and the second becomes an abandoned row somebody has
 * to reconcile later. The pending state is the whole guard.
 *
 * ── `window.location` RATHER THAN `router.push` ──
 *
 * The destination is Paystack's domain. The Next router is for routes inside
 * this app; handing it an external URL is a category error, and the browser
 * needs a real navigation here anyway so the payment page owns the history
 * entry the back button will return to.
 */
export function BuyButton({
  productId,
  label,
  className,
  initialCoupon,
  couponsAllowed = true,
}: {
  productId: string
  label: string
  className?: string
  /** From a shared link, `?coupon=CODE`. */
  initialCoupon?: string | null
  /** False on an UPGRADE. `start_training_upgrade` takes no code, so a coupon
   *  on that path is accepted by the box and then silently ignored by the
   *  charge, which is worse than not offering one: somebody types a code, sees
   *  it accepted, and pays the undiscounted amount. Operator, 2026-08-12: if it
   *  is an upgrade, do not show the coupon field at all. Plans are unaffected
   *  and keep theirs, because buying a plan is a purchase, not an upgrade. */
  couponsAllowed?: boolean
}) {
  const t = useTranslations('affiliate.public')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null)

  const buy = () => {
    setError(null)
    startTransition(async () => {
      const result = await startCheckout(productId, coupon?.code)
      if (!result.ok) {
        setError(result.message)
        return
      }
      window.location.href = result.url
    })
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={buy}
        disabled={pending}
        className={cn(
          'inline-flex w-full items-center justify-center gap-2 rounded-(--radius-input) px-5 py-3.5',
          'text-[0.9375rem] font-semibold text-white transition-colors',
          'bg-brand-600 hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70',
        )}
      >
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <ShoppingBag aria-hidden className="size-4" />
        )}
        {pending ? t('starting') : label}
      </button>

      {/* Below the button, not above it. The price on this page is the product's
          own; a code changes what is charged, and the buyer sees that in the
          box the moment it is applied.

          ⚠️ GONE ENTIRELY ON AN UPGRADE, not disabled and not hidden with a
          message. `initialCode` would otherwise auto-apply a code carried in a
          shared `?coupon=` link on a path that cannot honour it. */}
      {couponsAllowed && (
        <CouponField
          currency="GHS"
          initialCode={initialCoupon}
          applied={coupon}
          disabled={pending}
          onApplied={setCoupon}
          preview={(value) => previewProductCoupon(productId, value)}
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-[0.8125rem] text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}
