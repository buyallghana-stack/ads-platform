'use client'

import { useOptimistic, useTransition } from 'react'
import { Bookmark } from 'lucide-react'

import { cn } from '@/lib/cn'
import { toggleSaveAction } from '@/app/[locale]/shop/actions'

/**
 * The bookmark on every card in the reference.
 *
 * OPTIMISTIC, because a save is the cheapest possible commitment and the whole
 * point of it is that it costs nothing. Waiting ~300ms for a round trip before
 * the icon fills makes a free gesture feel expensive; if the write fails the
 * icon reverts, which is the correct amount of ceremony for a shortlist.
 *
 * `stopPropagation` because these sit inside a card that is itself a link —
 * without it, bookmarking a course opens it.
 */
export function SaveButton({
  productId,
  saved,
  className,
}: {
  productId: string
  saved: boolean
  className?: string
}) {
  const [pending, start] = useTransition()
  const [optimistic, setOptimistic] = useOptimistic(saved)

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      aria-label={optimistic ? 'Remove from saved' : 'Save for later'}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        start(async () => {
          setOptimistic(!optimistic)
          await toggleSaveAction(productId)
        })
      }}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full transition-colors',
        'bg-surface/90 backdrop-blur-sm hover:bg-surface',
        optimistic ? 'text-jade-700' : 'text-ink-500',
        className,
      )}
    >
      <Bookmark
        aria-hidden
        className="size-4"
        strokeWidth={2}
        fill={optimistic ? 'currentColor' : 'none'}
      />
    </button>
  )
}
