'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { ArrowLeft, SendHorizonal } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { sendSupportMessage } from '@/app/[locale]/(app)/support/actions'
import { Avatar } from '@/components/profile/Avatar'
import { Logo } from '@/components/brand/Logo'
import { useRouter } from '@/i18n/navigation'
import type { SupportMessage } from '@/lib/support/data'
import { cn } from '@/lib/cn'

/**
 * The support conversation, built to the operator's reference
 * (`design-references/support/01-support-chat.jpeg`): a day divider, bubbles
 * grouped into runs with one avatar per run, suggested questions above the
 * composer, and a round send button.
 *
 * TWO DEPARTURES FROM THE REFERENCE, both deliberate.
 *
 * The person's own bubbles are BRAND BLUE, not the reference's near-black.
 * Dark mode remaps the whole `ink` ramp by role, so an ink-900 bubble would
 * invert to a pale bubble with white text on it and become unreadable in one
 * theme. The brand ramp is not remapped, so blue is the only choice that is
 * the same colour in both.
 *
 * The suggested questions show only while the conversation is EMPTY. In the
 * reference they sit there permanently, which makes sense for a bot menu; on
 * a thread a person is already having with a person, canned questions under
 * their own sentences read as if nobody is listening.
 *
 * NOT BUILT YET: attachments. The reference has a paperclip, and somebody
 * disputing a payout will eventually want to send a screenshot — that needs a
 * bucket, size limits, its own RLS and an admin-side renderer, so it is a
 * follow-up rather than something half-done here.
 */

const DAY = 86_400_000

type Group = {
  author: SupportMessage['author']
  /** Day boundary this run belongs to, for the divider above it. */
  day: number
  messages: SupportMessage[]
}

/**
 * Consecutive messages from one author on one day become a run, so a person
 * who sends three lines gets one avatar and one tail rather than three.
 */
function groupMessages(messages: SupportMessage[]): Group[] {
  const groups: Group[] = []

  for (const message of messages) {
    const day = new Date(message.createdAt).setHours(0, 0, 0, 0)
    const last = groups.at(-1)

    if (last && last.author === message.author && last.day === day) {
      last.messages.push(message)
    } else {
      groups.push({ author: message.author, day, messages: [message] })
    }
  }

  return groups
}

export function SupportChat({
  messages,
  now,
  about,
  user,
}: {
  messages: SupportMessage[]
  /** Server clock, so the day dividers render identically on both sides.
   *  Seeding a date from Date.now() in a client component is the hydration
   *  mismatch this app has already been bitten by once. */
  now: number
  /** Where they came from — recorded with the first message they send. */
  about?: string
  user: { name: string }
}) {
  const t = useTranslations('support')
  const format = useFormatter()
  const router = useRouter()

  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, startSending] = useTransition()

  /*
    Messages sent in this tab, shown before the server has confirmed them.
    Cleared by COMPARING THE PROP DURING RENDER rather than in an effect: the
    ads tab learned that an optimistic layer reset by an effect survives about
    a second after router.refresh() and then contradicts the server.
  */
  const [optimistic, setOptimistic] = useState<SupportMessage[]>([])
  const [serverCount, setServerCount] = useState(messages.length)
  if (messages.length !== serverCount) {
    setServerCount(messages.length)
    setOptimistic([])
  }

  const all = [...messages, ...optimistic]
  const groups = groupMessages(all)

  const scroller = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // Newest message in view, the way every messaging app behaves. A DOM
    // synchronisation, not state, so it belongs in an effect.
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [all.length])

  function send(body: string) {
    const text = body.trim()
    if (!text || sending) return

    setError(null)
    setDraft('')
    setOptimistic((current) => [
      ...current,
      {
        id: `pending-${current.length}`,
        author: 'user',
        body: text,
        createdAt: new Date().toISOString(),
        readAt: null,
      },
    ])

    startSending(async () => {
      const result = await sendSupportMessage(text, about)
      if (!result.ok) {
        // Put the words back in the box. Losing what somebody typed because a
        // rate limit fired is the rudest possible way to say "wait".
        setOptimistic([])
        setDraft(text)
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  function dividerLabel(day: number): string {
    const startOfToday = new Date(now).setHours(0, 0, 0, 0)
    if (day === startOfToday) return t('today')
    if (day === startOfToday - DAY) return t('yesterday')
    return format.dateTime(new Date(day), { day: 'numeric', month: 'long' })
  }

  const suggestions = [t('ask.hold'), t('ask.upgrade'), t('ask.ads'), t('ask.payout')]

  return (
    /*
      Fills the viewport minus the mobile tab bar (`main` carries pb-24), so
      the transcript scrolls inside its own box and the composer stays put
      instead of being chased down a growing page.
    */
    <div className="mx-auto flex h-[calc(100dvh-6rem)] w-full max-w-xl flex-col px-4 sm:px-6 md:h-dvh">
      <header className="flex items-center gap-3 py-4">
        <button
          type="button"
          onClick={() => router.push('/profile')}
          aria-label={t('back')}
          className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-10"
        >
          <ArrowLeft aria-hidden className="size-4.5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink-900">{t('title')}</h1>
          <p className="truncate text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
        </div>
      </header>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto overscroll-contain border-t border-ink-200 py-4"
      >
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Logo showWordmark={false} />
            <p className="text-[0.9375rem] font-semibold text-ink-900">{t('empty.title')}</p>
            <p className="max-w-[22rem] text-[0.8125rem] leading-relaxed text-ink-500">
              {t('empty.body')}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {groups.map((group, index) => {
              const mine = group.author === 'user'
              const showDivider = index === 0 || groups[index - 1]!.day !== group.day

              return (
                <li key={`${group.day}-${index}`} className="flex flex-col gap-1.5">
                  {showDivider && (
                    <p className="py-1 text-center text-[0.75rem] text-ink-400">
                      {dividerLabel(group.day)}
                    </p>
                  )}

                  <div
                    className={cn(
                      'flex items-end gap-2',
                      mine ? 'flex-row-reverse' : 'flex-row',
                    )}
                  >
                    {/* One avatar per run, beside its last bubble — the
                        reference's grouping, and what stops a three-line
                        answer looking like three separate people. */}
                    <div className="shrink-0">
                      {mine ? (
                        <Avatar name={user.name} className="size-8" />
                      ) : (
                        /* The app icon itself, in the white tile it is always
                           given. Support is SidePerks talking, not a person
                           with a headshot. */
                        <Logo showWordmark={false} />
                      )}
                    </div>

                    <div className={cn('flex min-w-0 flex-col gap-1', mine ? 'items-end' : 'items-start')}>
                      {group.messages.map((message, i) => {
                        const last = i === group.messages.length - 1
                        return (
                          <p
                            key={message.id}
                            className={cn(
                              'max-w-[min(80%,26rem)] px-3.5 py-2 text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap',
                              // A tight corner on the tail side of the last
                              // bubble in a run, round everywhere else.
                              mine
                                ? cn('rounded-2xl bg-brand-600 text-white', last && 'rounded-br-sm')
                                : cn(
                                    'rounded-2xl border border-ink-200 bg-surface text-ink-800',
                                    last && 'rounded-bl-sm',
                                  ),
                              message.id.startsWith('pending-') && 'opacity-60',
                            )}
                          >
                            {message.body}
                          </p>
                        )
                      })}
                      <p className="px-1 text-[0.6875rem] text-ink-400">
                        {format.dateTime(new Date(group.messages.at(-1)!.createdAt), {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <div className="border-t border-ink-200 pt-3 pb-4">
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2 text-[0.8125rem] leading-relaxed text-danger-700"
          >
            {error}
          </p>
        )}

        {groups.length === 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                disabled={sending}
                className="rounded-full border border-ink-200 bg-surface px-3 py-1.5 text-[0.8125rem] text-ink-700 transition-colors hover:border-brand-600/40 hover:text-brand-700 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            maxLength={2000}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 py-2.5 text-[0.9375rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            aria-label={t('send')}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            <SendHorizonal aria-hidden className="size-4.5" />
          </button>
        </form>
      </div>
    </div>
  )
}
