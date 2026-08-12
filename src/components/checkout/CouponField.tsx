'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { Check, Tag, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

export type CouponQuote =
  | { ok: true; discountMinor: number; chargedMinor: number }
  | { ok: false; reason: string }

export type AppliedCoupon = { code: string; discountMinor: number; chargedMinor: number }

/**
 * The coupon box, on both checkouts.
 *
 * ── QUOTING IS NOT RESERVING ──
 *
 * Typing a code asks the database what it would do and nothing else. The place
 * in the quota is taken when the purchase starts, so somebody who tries a code
 * and closes the sheet has held nothing. That is why this can auto-apply a
 * code arriving in the URL without it costing anybody a place.
 *
 * ── THE PRICE SHOWN IS THE PRICE CHARGED ──
 *
 * The quote comes from `coupon_quote`, which is the same function
 * `start_subscription_payment` and `start_product_order` apply. There is no
 * second implementation of the discount arithmetic here: this component
 * renders numbers, it does not work them out.
 *
 * A refusal names its reason in the buyer's language rather than saying the
 * code is unknown. Telling somebody their real code is unrecognised, when the
 * truth is that it is for another plan, sends them to support.
 */
export function CouponField({
  currency,
  initialCode,
  applied,
  preview,
  onApplied,
  disabled,
}: {
  currency: string
  /** From a shared link, `?coupon=CODE`. Applied once, on arrival. */
  initialCode?: string | null
  applied: AppliedCoupon | null
  preview: (code: string) => Promise<CouponQuote>
  onApplied: (applied: AppliedCoupon | null) => void
  disabled?: boolean
}) {
  const t = useTranslations('checkout.coupon')
  const format = useFormatter()

  const [code, setCode] = useState(initialCode ?? '')
  const [reason, setReason] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const apply = (value: string) =>
    startTransition(async () => {
      setReason(null)
      const trimmed = value.trim()
      if (!trimmed) return

      const quote = await preview(trimmed)
      if (quote.ok) {
        onApplied({
          code: trimmed.toUpperCase(),
          discountMinor: quote.discountMinor,
          chargedMinor: quote.chargedMinor,
        })
      } else {
        onApplied(null)
        setReason(quote.reason)
      }
    })

  /* A link carrying a code applies it on arrival, so the price is already
     reduced when the sheet opens. Once only: `applyRef` rather than a
     dependency list, because re-running this after the amount changes would
     re-apply a code the buyer had just removed. */
  const applyRef = useRef(false)
  useEffect(() => {
    if (applyRef.current || !initialCode) return
    applyRef.current = true
    apply(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  const money = (minor: number) =>
    format.number(minor / 100, { style: 'currency', currency, maximumFractionDigits: 2 })

  if (applied) {
    return (
      <div className="mt-3 flex items-center gap-2.5 rounded-(--radius-card) border border-success-500/25 bg-success-50 px-3.5 py-2.5">
        <Check aria-hidden className="size-4 shrink-0 text-success-700" />
        <p className="min-w-0 flex-1 text-[0.8125rem] text-success-700">
          {t('applied', { code: applied.code, off: money(applied.discountMinor) })}
        </p>
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => {
            onApplied(null)
            setCode('')
            setReason(null)
          }}
          className="shrink-0 rounded p-0.5 text-success-700/70 hover:text-success-700"
        >
          <X aria-hidden className="size-4" />
          <span className="sr-only">{t('remove')}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Tag
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400"
          />
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setReason(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                apply(code)
              }
            }}
            disabled={disabled}
            spellCheck={false}
            autoCapitalize="characters"
            placeholder={t('placeholder')}
            aria-label={t('label')}
            aria-invalid={reason !== null}
            className={cn(
              'h-11 w-full rounded-(--radius-input) border bg-canvas pr-3 pl-9',
              'font-mono text-[0.875rem] tracking-[0.1em] text-ink-900 uppercase',
              'placeholder:font-sans placeholder:tracking-normal placeholder:normal-case',
              'focus:outline-none disabled:opacity-60',
              reason ? 'border-danger-500' : 'border-ink-200 focus:border-brand-600',
            )}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          loading={pending}
          disabled={disabled || code.trim().length === 0}
          onClick={() => apply(code)}
        >
          {t('apply')}
        </Button>
      </div>

      {reason && (
        <p role="alert" className="mt-1.5 text-[0.75rem] font-medium text-danger-600">
          {/* Every branch `coupon_quote` can answer with has a sentence. An
              unmapped reason falls back rather than rendering a raw key. */}
          {t.has(`reason.${reason}`) ? t(`reason.${reason}`) : t('reason.unknown')}
        </p>
      )}
    </div>
  )
}
