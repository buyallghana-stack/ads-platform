'use client'

import { useState, useTransition } from 'react'

import { Heart } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/cn'

/**
 * The bookmark on a product card.
 *
 * ── WHY THIS ONE TALKS TO THE DATABASE FROM THE BROWSER ──
 *
 * Every other Phase 2 read goes through the admin client on the server, because
 * every Phase 2 RPC is revoked from `authenticated` (migration 127). Saves are
 * the deliberate exception (migration 144): `saved_products` has real
 * own-rows RLS, so the browser can write its own row safely, and routing a
 * bookmark tap through a server action would add a round trip and a full page
 * revalidation to a control whose entire job is to feel instant.
 *
 * ── OPTIMISTIC, AND HONEST ABOUT FAILING ──
 *
 * The heart fills on tap and rolls back if the write is refused. It does not
 * show an error: a failed bookmark is not worth a toast, and the rollback IS
 * the message — the heart empties again, which is exactly what "that did not
 * save" looks like. What it must never do is stay filled over a row that does
 * not exist, because the next page load would silently disagree with it.
 */
export function SaveButton({
  productId,
  saved,
  title,
}: {
  productId: string
  saved: boolean
  title: string
}) {
  const t = useTranslations('affiliate.market')
  const [on, setOn] = useState(saved)
  const [, startTransition] = useTransition()

  const toggle = () => {
    const next = !on
    setOn(next)

    startTransition(async () => {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      const userId = data.user?.id
      if (!userId) {
        setOn(!next)
        return
      }

      const { error } = next
        ? await supabase.from('saved_products').insert({ user_id: userId, product_id: productId })
        : await supabase
            .from('saved_products')
            .delete()
            .eq('user_id', userId)
            .eq('product_id', productId)

      /* A duplicate insert is not a failure — it means the row this tap was
         trying to create is already there, which is the state the user asked
         for. Rolling back on 23505 would make a double tap look broken. */
      if (error && error.code !== '23505') setOn(!next)
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={t(on ? 'unsaveLabel' : 'saveLabel', { title })}
      className={cn(
        'grid size-9 place-items-center rounded-full bg-black/45 backdrop-blur-sm transition-colors',
        'hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
        'pointer-coarse:size-10',
        on ? 'text-danger-500' : 'text-white',
      )}
    >
      <Heart aria-hidden className="size-4.5" fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}
