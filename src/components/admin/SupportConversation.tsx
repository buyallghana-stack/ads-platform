'use client'

import { useEffect, useRef, useState } from 'react'

import { CheckCircle2, RotateCcw, SendHorizonal } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import type { AdminSupportThread } from '@/lib/admin/data/support'
import { cn } from '@/lib/cn'

/**
 * The conversation inside the person panel: transcript, reply box, and the
 * one state change an operator has here — filing it as done.
 *
 * NARROWER BUBBLES THAN THE USER'S SCREEN, and no avatars. The panel is 27rem
 * of drawer beside a list; the point here is reading a thread quickly next to
 * the account facts above it, not recreating a messaging app. Who said what
 * is carried by side and colour, which is all it needs at this width.
 *
 * Loading is shown rather than an empty transcript. "No messages yet" while a
 * fetch is in flight is the one thing this panel must never say about a
 * person who has written in.
 */
export function SupportConversation({
  thread,
  loading,
  busy,
  onReply,
  onToggleStatus,
}: {
  thread: AdminSupportThread | null
  loading: boolean
  busy: boolean
  onReply: (body: string) => void
  onToggleStatus: (closed: boolean) => void
}) {
  const t = useTranslations('admin.messages')
  const format = useFormatter()
  const [draft, setDraft] = useState('')

  const scroller = useRef<HTMLDivElement | null>(null)
  const count = thread?.messages.length ?? 0
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])

  if (loading) {
    return <p className="py-4 text-[0.8125rem] text-ink-400">{t('loading')}</p>
  }

  if (!thread) return null

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={scroller}
        className="flex max-h-[22rem] flex-col gap-2 overflow-y-auto overscroll-contain"
      >
        {thread.messages.length === 0 ? (
          <p className="py-3 text-[0.8125rem] text-ink-400">{t('noMessages')}</p>
        ) : (
          thread.messages.map((message) => {
            const fromUs = message.author === 'admin'
            return (
              <div
                key={message.id}
                className={cn('flex flex-col gap-0.5', fromUs ? 'items-end' : 'items-start')}
              >
                <p
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap',
                    fromUs
                      ? 'rounded-br-sm bg-brand-600 text-white'
                      : 'rounded-bl-sm border border-ink-200 bg-canvas text-ink-800',
                  )}
                >
                  {message.body}
                </p>
                <p className="px-1 text-[0.6875rem] text-ink-400">
                  {/* The administrator's name on our side, so a second
                      operator reading this later knows who answered. */}
                  {fromUs && message.authorName ? `${message.authorName} · ` : ''}
                  {format.dateTime(new Date(message.createdAt), {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            )
          })
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          const body = draft.trim()
          if (!body || busy) return
          setDraft('')
          onReply(body)
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={t('replyPlaceholder')}
          aria-label={t('replyPlaceholder')}
          className="max-h-40 min-h-16 flex-1 resize-none rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-2 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          aria-label={t('reply')}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          <SendHorizonal aria-hidden className="size-4" />
        </button>
      </form>

      {/* Closing is filing, not locking: the person's next message reopens it,
          which the label says out loud so nobody expects it to silence them. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggleStatus(thread.status === 'open')}
        className="inline-flex items-center gap-1.5 self-start rounded-full border border-ink-200 px-3 py-1.5 text-[0.75rem] font-medium text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 disabled:opacity-50"
      >
        {thread.status === 'open' ? (
          <>
            <CheckCircle2 aria-hidden className="size-3.5" />
            {t('markDone')}
          </>
        ) : (
          <>
            <RotateCcw aria-hidden className="size-3.5" />
            {t('reopen')}
          </>
        )}
      </button>
    </div>
  )
}
