import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  RotateCcw,
  Scale,
} from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'

import type { CommissionEntryType, StatementEntry } from '@/lib/market/data'
import { cedis } from '@/lib/market/money'
import { cn } from '@/lib/cn'

/**
 * The commission statement.
 *
 * ── EVERY ROW SAYS WHAT KIND OF EVENT IT WAS, IN WORDS ──
 *
 * A signed amount cannot distinguish the four entry types, and two of them
 * take money away for opposite reasons: a PAYOUT is money reaching the
 * affiliate, a REVERSAL is a sale being undone. Rendering both as "-GHS 60.00"
 * in red would tell somebody they lost sixty cedis on the day they were paid
 * sixty cedis.
 *
 * So each row carries an icon, a label and a colour keyed to the type, and the
 * amount's sign is left to say only what it says: which direction the balance
 * moved.
 *
 * ── PENDING ROWS SAY WHEN, NOT JUST THAT ──
 *
 * "Pending" with no date is the single most common support question a
 * commission system generates. `clears_at` is on every pending row.
 *
 * ── LEVEL 2 IS LABELLED ──
 *
 * On a two-level account the obvious question about a smaller-than-expected
 * entry is answered entirely by which level it was, so the badge is on the row
 * rather than in a legend somewhere.
 */

const LOOK: Record<
  CommissionEntryType,
  { Icon: typeof ArrowDownLeft; chip: string; amount: string }
> = {
  credit: {
    Icon: ArrowDownLeft,
    chip: 'bg-success-500/15 text-success-600',
    amount: 'text-success-600',
  },
  payout: {
    Icon: ArrowUpRight,
    chip: 'bg-brand-600/15 text-brand-700',
    amount: 'text-ink-900',
  },
  reversal: {
    Icon: RotateCcw,
    chip: 'bg-danger-500/15 text-danger-600',
    amount: 'text-danger-600',
  },
  adjustment: {
    Icon: Scale,
    chip: 'bg-orange-500/15 text-orange-600',
    amount: 'text-ink-900',
  },
}

export async function StatementList({ entries }: { entries: StatementEntry[] }) {
  const t = await getTranslations('affiliate.statement')
  const format = await getFormatter()

  if (entries.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[0.8125rem] text-ink-500">{t('empty')}</p>
    )
  }

  return (
    <ul className="divide-y divide-ink-200">
      {entries.map((entry) => {
        const look = LOOK[entry.entry_type]
        const pending = entry.status === 'pending'
        return (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-3.5">
            <span
              aria-hidden
              className={cn('grid size-9 shrink-0 place-items-center rounded-full', look.chip)}
            >
              <look.Icon className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[0.875rem] font-medium text-ink-900">
                  {t(`type.${entry.entry_type}`)}
                </span>
                {entry.level === 2 && (
                  <span className="rounded-full bg-brand-600/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-brand-700">
                    {t('levelTwo')}
                  </span>
                )}
              </p>

              {(entry.product_title || entry.reason) && (
                <p className="mt-0.5 truncate text-[0.8125rem] text-ink-500">
                  {entry.product_title ?? entry.reason}
                </p>
              )}

              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-ink-400">
                <span>
                  {format.dateTime(new Date(entry.created_at), {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                {pending && entry.clears_at && (
                  <span className="inline-flex items-center gap-1 text-warning-600">
                    <Clock aria-hidden className="size-3" />
                    {t('clearsOn', {
                      date: format.dateTime(new Date(entry.clears_at), {
                        day: 'numeric',
                        month: 'short',
                      }),
                    })}
                  </span>
                )}
              </p>
            </div>

            <p
              className={cn(
                'shrink-0 text-[0.875rem] font-semibold tabular-nums',
                look.amount,
                /* A pending credit is dimmed rather than coloured: it is real,
                   it is just not spendable, and full green on a figure that
                   cannot be withdrawn is a promise the balance does not keep. */
                pending && 'opacity-60',
              )}
            >
              {entry.amount_minor > 0 ? '+' : ''}
              {cedis(entry.amount_minor)}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
