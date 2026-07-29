import { MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Support launcher in the Home header.
 *
 * It used to be a seat: a button that opened a note saying chat was coming,
 * because the chatbot was expected from the operator later. The operator chose
 * an in-house inbox answered by people instead, so this is now simply a link
 * to the conversation, and the grey "not live" dot is gone with it.
 *
 * No unread dot here on purpose. An admin's reply already raises a
 * notification, so the bell beside this button is the signal — two indicators
 * for one event teaches people to trust neither. It is also one fewer query on
 * a screen that renders on every visit.
 *
 * Styling still mirrors ThemeSwitchButton so the header controls read as one
 * set.
 */
export function SupportChatButton({ className }: { className?: string }) {
  const t = useTranslations('support')

  return (
    <Link
      href="/support"
      aria-label={t('title')}
      className={cn(
        'grid size-9 place-items-center rounded-full text-ink-500 transition-colors',
        'hover:bg-ink-100 hover:text-ink-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        'pointer-coarse:size-10',
        className,
      )}
    >
      <MessageCircle aria-hidden className="size-[1.15rem]" />
    </Link>
  )
}
