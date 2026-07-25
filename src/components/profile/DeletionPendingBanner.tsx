'use client'

import { useState, useTransition } from 'react'

import { CalendarClock } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { cancelDeletionRequest } from '@/app/[locale]/(app)/profile/delete/actions'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'

/**
 * Shown while a deletion is scheduled.
 *
 * Signing in cancels the request, so anyone reading this has already cancelled
 * it by being here — EXCEPT the session that made the request and navigated
 * back instead of leaving. That case is real, and it deserves an explicit way
 * out rather than "sign out and back in again".
 */
export function DeletionPendingBanner({
  effectiveAt,
  daysLeft,
}: {
  effectiveAt: string
  daysLeft: number
}) {
  const t = useTranslations('deleteAccount.pending')
  const format = useFormatter()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [gone, setGone] = useState(false)

  if (gone) return null

  const cancel = () =>
    startTransition(async () => {
      const res = await cancelDeletionRequest()
      if (res.ok) {
        setGone(true)
        router.refresh()
      }
    })

  return (
    <div
      style={{ '--rise-delay': '0.02s' } as React.CSSProperties}
      className="animate-rise mb-4 flex flex-col gap-3 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 p-4 sm:flex-row sm:items-center"
    >
      <CalendarClock aria-hidden className="size-5 shrink-0 text-danger-600" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-semibold text-danger-700">
          {t('title', { days: daysLeft })}
        </p>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-danger-700/85">
          {t('body', {
            date: format.dateTime(new Date(effectiveAt), {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </p>
      </div>
      <Button variant="secondary" size="sm" loading={pending} onClick={cancel}>
        {t('cta')}
      </Button>
    </div>
  )
}
