'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2, Gift } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { redeemCommissionGiftCode } from '@/app/[locale]/(affiliate)/market/gift-code/actions'
import { Button } from '@/components/ui/Button'
import { Link, useRouter } from '@/i18n/navigation'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * Entering a gift code that pays CEDIS.
 *
 * ── WHY THIS IS NOT THE ADS FORM WITH A PROP ──
 *
 * D27, and the difference is not cosmetic: this one reports a money amount
 * rather than a point count, returns to the affiliate dashboard rather than
 * Home, and has a refusal the other cannot have (no affiliate account). A
 * shared component would carry all of that as branches, and the branch that
 * eventually goes wrong is the one that decides which balance was credited.
 *
 * ── THE INPUT HANDLING IS DELIBERATELY IDENTICAL ──
 *
 * Same alphabet, same length, same cleaning. Codes travel by WhatsApp, radio
 * and word of mouth, and the lessons the ads field learned apply unchanged:
 * uppercase as you type, strip spaces and dashes out of a paste, and turn off
 * autocorrect, because a keyboard that "corrects" a code turns a valid one
 * invalid. The server normalises all of it anyway; doing it here is so the
 * field shows what will actually be submitted.
 */

const ALLOWED = /[^0-9A-HJKMNP-TV-Z]/g
const LENGTH = 12

export function CommissionGiftCodeForm() {
  const t = useTranslations('affiliate.giftCode')
  const router = useRouter()

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [won, setWon] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()

  const clean = (raw: string) => raw.toUpperCase().replace(ALLOWED, '').slice(0, LENGTH)
  const complete = code.length === LENGTH

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!complete || pending) return
    setError(null)

    startTransition(async () => {
      const result = await redeemCommissionGiftCode(code)

      if (result.ok) {
        setWon(result.amountMinor)
        router.refresh()
        return
      }

      setError(t(`errors.${result.reason}`))
      if (result.reason === 'not_found') setCode('')
    })
  }

  if (won !== null) {
    return (
      <div className="animate-rise mt-10 flex flex-col items-center text-center">
        <span className="grid size-16 place-items-center rounded-full bg-success-50 text-success-600">
          <CheckCircle2 aria-hidden className="size-8" strokeWidth={2.25} />
        </span>
        <h2 className="mt-4 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('success.title')}
        </h2>
        <p className="mt-1.5 text-[0.9375rem] text-ink-600">
          {t('success.body', { amount: cedis(won) })}
        </p>
        <div className="mt-6 flex w-full max-w-[18rem] flex-col gap-2.5">
          <Link href="/commission" className="block">
            <Button size="lg" fullWidth>
              {t('success.balance')}
            </Button>
          </Link>
          <button
            type="button"
            onClick={() => {
              setWon(null)
              setCode('')
            }}
            className="text-[0.8125rem] font-medium text-brand-700 hover:text-brand-800"
          >
            {t('success.another')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-rise">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-full bg-brand-600/12 text-brand-700">
          <Gift aria-hidden className="size-7" />
        </span>
        <h1 className="mt-3.5 text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h1>
        <p className="mt-1.5 max-w-[34ch] text-[0.875rem] leading-relaxed text-ink-500">
          {t('subtitle')}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-danger-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-5">
        <label htmlFor="commission-gift-code" className="text-[0.8125rem] font-medium text-ink-700">
          {t('label')}
        </label>
        <input
          id="commission-gift-code"
          value={code}
          onChange={(e) => setCode(clean(e.target.value))}
          onPaste={(e) => {
            e.preventDefault()
            setCode(clean(e.clipboardData.getData('text')))
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={t('placeholder')}
          aria-describedby="commission-gift-code-hint"
          className={cn(
            'mt-1.5 h-14 w-full rounded-(--radius-input) border bg-surface text-center',
            'font-mono text-[1.125rem] uppercase tracking-[0.2em] text-ink-900',
            'placeholder:normal-case placeholder:tracking-[0.1em] placeholder:text-ink-400',
            'focus:shadow-[0_0_0_3px] focus:outline-none',
            complete
              ? 'border-success-500 focus:border-success-600 focus:shadow-success-600/12'
              : 'border-ink-200 focus:border-brand-600 focus:shadow-brand-600/12',
          )}
        />
        <p
          id="commission-gift-code-hint"
          className="mt-1.5 text-center text-[0.75rem] tabular-nums text-ink-400"
        >
          {t('hint', { entered: code.length, total: LENGTH })}
        </p>

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!complete}
          className="mt-4"
        >
          {t('submit')}
        </Button>
      </form>
    </div>
  )
}
