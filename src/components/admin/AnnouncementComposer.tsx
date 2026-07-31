'use client'

import { useState, useTransition } from 'react'

import { AlertTriangle, Megaphone, Send, X } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { sendAnnouncement } from '@/app/[locale]/admin/(super)/announcements/actions'
import { NotificationCard } from '@/components/notifications/NotificationCard'
import { Button } from '@/components/ui/Button'
import type { Announcement } from '@/lib/admin/data/announcements'
import { cn } from '@/lib/cn'

/**
 * Compose an announcement, see exactly what it will look like, send it once.
 *
 * THE PREVIEW IS THE REAL CARD. It renders `NotificationCard` — the same
 * component the user's bell and notifications page use — rather than a mock-up
 * of it. A preview that is merely similar is a preview that can lie, and this
 * is the one message the operator cannot take back.
 *
 * WHICH IS ALSO WHY THERE IS A CONFIRM STEP. Every other admin action here is
 * reversible: a flag can be cleared, a payout can be held, an ad can be
 * archived. A notification sitting in ten thousand bells cannot be recalled,
 * edited or deleted. So the count is shown, and the button says how many
 * people it is about to reach rather than just "Send".
 */
export function AnnouncementComposer({
  audience,
  history,
  now,
}: {
  audience: number
  history: Announcement[]
  now: number
}) {
  const t = useTranslations('admin.announcements')
  const format = useFormatter()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<number | null>(null)
  const [rows, setRows] = useState(history)
  const [pending, startSending] = useTransition()

  const ready = title.trim().length > 0 && body.trim().length > 0

  const send = () => {
    setError(null)
    startSending(async () => {
      const result = await sendAnnouncement({ title, body })
      setConfirming(false)

      if (!result.ok) {
        setError(result.message)
        return
      }

      // Cleared only on success: a refused send must not cost somebody the
      // paragraph they just wrote.
      setSent(result.recipients)
      setRows(result.announcements)
      setTitle('')
      setBody('')
    })
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-(--radius-card) border border-danger-500/25 bg-danger-50 px-3.5 py-3"
          >
            <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-danger-700" />
            <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-danger-700">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded p-0.5 text-danger-700/70 hover:text-danger-700"
            >
              <X aria-hidden className="size-4" />
              <span className="sr-only">{t('dismiss')}</span>
            </button>
          </div>
        )}

        {sent !== null && (
          <p
            role="status"
            className="rounded-(--radius-card) border border-success-500/25 bg-success-50 px-3.5 py-3 text-[0.8125rem] text-success-700"
          >
            {t('sentTo', { count: sent })}
          </p>
        )}

        <div className="rounded-(--radius-card) border border-ink-200 bg-surface p-4 sm:p-5">
          <label className="block">
            <span className="text-[0.8125rem] font-medium text-ink-700">{t('titleLabel')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={t('titlePlaceholder')}
              className="mt-1.5 w-full rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2.5 text-[0.9375rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
            />
          </label>

          {/* The counter is a SIBLING of the label, not inside it. Anything
              inside a <label> becomes part of the control's accessible name,
              so a counter there made the field announce as "Message 0/1000"
              and change its own name on every keystroke. Caught by a Playwright
              strict-mode violation, which is what a screen-reader user would
              have heard. */}
          <div className="mt-4">
            <label className="block">
              <span className="text-[0.8125rem] font-medium text-ink-700">{t('bodyLabel')}</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={1000}
                placeholder={t('bodyPlaceholder')}
                className="mt-1.5 w-full resize-y rounded-(--radius-input) border border-ink-200 bg-canvas px-3 py-2.5 text-[0.875rem] leading-relaxed text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
              />
            </label>
            <span aria-hidden className="mt-1 block text-right text-[0.6875rem] text-ink-400 tabular-nums">
              {body.length}/1000
            </span>
          </div>

          {!confirming ? (
            <Button
              type="button"
              disabled={!ready || pending}
              onClick={() => setConfirming(true)}
              className="mt-2"
            >
              <Megaphone aria-hidden className="size-4" />
              {t('review')}
            </Button>
          ) : (
            /* The last thing between a draft and every bell in the country. */
            <div className="mt-2 rounded-(--radius-card) border border-warning-500/30 bg-warning-50 p-3.5">
              <p className="text-[0.8125rem] leading-relaxed text-ink-700">
                {t('confirmBody', { count: audience })}
              </p>
              <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-500">
                {t('confirmIrreversible')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={send} loading={pending}>
                  <Send aria-hidden className="size-4" />
                  {t('sendNow', { count: audience })}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* History ---------------------------------------------------- */}
        <div className="rounded-(--radius-card) border border-ink-200 bg-surface">
          <h2 className="border-b border-ink-200 px-4 py-3 text-[0.8125rem] font-semibold text-ink-900">
            {t('historyTitle')}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-[0.8125rem] text-ink-400">{t('historyEmpty')}</p>
          ) : (
            <ul className="divide-y divide-ink-200">
              {rows.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-[0.875rem] font-medium text-ink-900">
                      {row.title}
                    </p>
                    <time
                      dateTime={row.createdAt}
                      className="shrink-0 text-[0.6875rem] text-ink-400 tabular-nums"
                    >
                      {format.relativeTime(new Date(row.createdAt), now)}
                    </time>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-600">
                    {row.body}
                  </p>
                  <p className="mt-1 text-[0.6875rem] text-ink-400">
                    {t('historyMeta', { name: row.sentByName, count: row.recipientCount })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Preview ------------------------------------------------------ */}
      <aside className="w-full shrink-0 lg:w-[22rem]">
        <p className="mb-2 text-[0.75rem] font-semibold tracking-[0.04em] text-ink-500 uppercase">
          {t('previewLabel')}
        </p>
        <div
          className={cn(
            'rounded-(--radius-card) border border-ink-200 bg-surface px-3 py-1',
            !ready && 'opacity-60',
          )}
        >
          <NotificationCard
            notification={{
              id: 'preview',
              type: 'announcement',
              title: title.trim() || t('titlePlaceholder'),
              body: body.trim() || t('bodyPlaceholder'),
              read_at: null,
              created_at: new Date(now).toISOString(),
            }}
            now={now}
          />
        </div>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-500">{t('previewHint')}</p>
      </aside>
    </div>
  )
}
