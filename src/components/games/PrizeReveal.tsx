'use client'

import { useFormatter, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * What you won, shared by both games.
 *
 * One component so a prize cannot look like a bigger deal on the wheel than
 * in the box, and so the "play again" rules can only be written once.
 *
 * Colour comes from the prize the operator configured, not from the product
 * palette — these screens were explicitly allowed to be loud.
 */
export function PrizeReveal({
  label,
  points,
  extraPlays,
  remaining,
  colour,
  onAgain,
}: {
  label: string
  points: number
  extraPlays: number
  remaining: number
  colour: string
  onAgain: () => void
}) {
  const t = useTranslations('games')
  const format = useFormatter()

  return (
    <div
      role="status"
      className="animate-rise flex flex-col items-center text-center"
      style={{ '--prize': colour } as React.CSSProperties}
    >
      <span
        className="grid size-20 place-items-center rounded-full text-[2rem] shadow-lg"
        style={{ backgroundColor: colour }}
        aria-hidden
      >
        🎉
      </span>

      <p className="mt-4 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-ink-500">
        {t('reveal.youWon')}
      </p>
      <p className="mt-1 text-[1.75rem] font-bold tracking-[-0.02em] text-ink-900">{label}</p>

      {/* Only when it ADDS something. Operators name prizes after their value
          ("300 points"), so printing "+300 points" underneath just says the
          same thing twice; the credit line is worth showing when the label is
          a name rather than a number ("Jackpot", "Extra play"). */}
      {points > 0 && !label.replace(/[,\s]/g, '').includes(String(points)) && (
        <p className="mt-1 text-[0.9375rem] font-medium text-success-600">
          +{format.number(points)} {t('reveal.points')}
        </p>
      )}
      {extraPlays > 0 && (
        <p className="mt-1 text-[0.9375rem] font-medium text-brand-700">
          {t('reveal.extraPlays', { count: extraPlays })}
        </p>
      )}

      <div className="mt-6 flex w-full max-w-[18rem] flex-col gap-2.5">
        {remaining > 0 ? (
          <Button size="lg" fullWidth onClick={onAgain}>
            {t('reveal.again', { count: remaining })}
          </Button>
        ) : (
          /* No plays left is not a failure — it is the end of the week's
             allowance, and the honest next step is the plan that grants more. */
          <>
            <p className={cn('text-[0.8125rem] text-ink-500')}>{t('reveal.spent')}</p>
            <Link href="/upgrade" className="block">
              <Button size="lg" fullWidth>
                {t('reveal.upgrade')}
              </Button>
            </Link>
          </>
        )}
        <Link href="/games" className="block">
          <button
            type="button"
            className="w-full text-[0.8125rem] font-medium text-brand-700 hover:text-brand-800"
          >
            {t('reveal.backToGames')}
          </button>
        </Link>
      </div>
    </div>
  )
}
