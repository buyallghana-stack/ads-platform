'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2, Gift } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { redeemGiftCode } from '@/app/[locale]/(app)/gift-code/actions'
import { Button } from '@/components/ui/Button'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Entering a gift code.
 *
 * Codes are 12 characters from a Crockford-style alphabet, and they travel by
 * WhatsApp, radio and word of mouth. So:
 *
 *   - the field uppercases as you type, because half of Ghana's phones will
 *     autocapitalise the first character and nothing else;
 *   - pasting is refused (operator, 2026-09-24): a code has to be typed, one
 *     character at a time, so a code shared in a group is not simply won by
 *     whoever pastes fastest;
 *   - `autoCapitalize`/`autoCorrect`/`spellCheck` are all off — a keyboard
 *     that "corrects" a code turns a valid one invalid;
 *   - the input is `inputMode="text"` and not numeric, since the alphabet is
 *     mixed.
 *
 * The server normalises all of this anyway. Doing it here as well is so the
 * field shows the user what will actually be submitted.
 */

/** The alphabet the generator uses. Anything else cannot be part of a code,
 *  so it is dropped rather than left to fail server-side. */
const ALLOWED = /[^0-9A-HJKMNP-TV-Z]/g
const LENGTH = 12

export function GiftCodeForm() {
  const t = useTranslations('giftCode')
  const format = useFormatter()
  const router = useRouter()

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [won, setWon] = useState<number | null>(null)
  const [pasteBlocked, setPasteBlocked] = useState(false)
  const [pending, startTransition] = useTransition()

  const clean = (raw: string) => raw.toUpperCase().replace(ALLOWED, '').slice(0, LENGTH)
  const complete = code.length === LENGTH

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!complete || pending) return
    setError(null)

    startTransition(async () => {
      const result = await redeemGiftCode(code)

      if (result.ok) {
        setWon(result.points)
        // The balance on Home has changed; refresh so going back is honest.
        router.refresh()
        return
      }

      setError(t(`errors.${result.reason}`))
      // Wrong codes clear, so the next attempt starts from an empty field
      // rather than the user editing a code that was never right.
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
          {t('success.body', { points: format.number(won) })}
        </p>
        <div className="mt-6 flex w-full max-w-[18rem] flex-col gap-2.5">
          <Link href="/dashboard" className="block">
            <Button size="lg" fullWidth>
              {t('success.home')}
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
    /*
      CONTAINED, NOT SPREAD (operator, 2026-08-12: this page "fills the screen
      too much"). It was a 56px icon, a 1.25rem heading, a two-line subtitle,
      a 56px-tall input and a full-width button, each stretched edge to edge
      with a screen and a half of nothing underneath. One short form floating
      in an empty page reads as unfinished rather than as focused.

      Everything is inside a card now, at the sizes the rest of the app uses
      for a single-purpose form. Nothing was removed: the icon, the heading,
      the explanation, the field, the counter and the button are all still
      here.
    */
    <div className="animate-rise rounded-(--radius-panel) border border-ink-200 bg-surface p-5 sm:p-6">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-11 place-items-center rounded-full bg-orange-50 text-orange-600">
          <Gift aria-hidden className="size-5" />
        </span>
        <h1 className="mt-3 text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h1>
        <p className="mt-1 max-w-[32ch] text-[0.8125rem] leading-relaxed text-ink-500">
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
        <label htmlFor="gift-code" className="text-[0.8125rem] font-medium text-ink-700">
          {t('label')}
        </label>
        <input
          id="gift-code"
          value={code}
          onChange={(e) => {
            // One character per change. A phone keyboard's clipboard chip
            // inserts the whole code without firing `paste`, so blocking the
            // event alone would not stop it; a jump of more than one
            // character is refused whatever caused it. Deleting is free.
            const next = clean(e.target.value)
            if (next.length > code.length + 1) {
              setPasteBlocked(true)
              return
            }
            setPasteBlocked(false)
            setCode(next)
          }}
          onPaste={(e) => {
            // Operator, 2026-09-24: codes must be TYPED. A code copied out of
            // a group chat is redeemed by whoever pastes fastest, which
            // undermines a campaign that hands codes out one by one.
            e.preventDefault()
            setPasteBlocked(true)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setPasteBlocked(true)
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          placeholder={t('placeholder')}
          aria-describedby="gift-code-hint"
          className={cn(
            'mt-1.5 h-12 w-full rounded-(--radius-input) border bg-canvas text-center',
            'font-mono text-[1rem] tracking-[0.18em] text-ink-900 uppercase',
            'placeholder:tracking-[0.1em] placeholder:text-ink-300 placeholder:normal-case',
            'focus:outline-none focus:shadow-[0_0_0_3px]',
            complete
              ? 'border-success-500 focus:border-success-600 focus:shadow-success-600/12'
              : 'border-ink-200 focus:border-brand-600 focus:shadow-brand-600/12',
          )}
        />
        <p
          id="gift-code-hint"
          aria-live="polite"
          className={cn(
            'mt-1.5 text-center text-[0.75rem] tabular-nums',
            pasteBlocked ? 'text-danger-700' : 'text-ink-400',
          )}
        >
          {pasteBlocked ? t('noPaste') : t('hint', { entered: code.length, total: LENGTH })}
        </p>

        <Button type="submit" size="lg" fullWidth loading={pending} disabled={!complete} className="mt-4">
          {t('submit')}
        </Button>
      </form>
    </div>
  )
}
