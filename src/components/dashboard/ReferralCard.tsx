'use client'

import { useEffect, useRef, useState } from 'react'

import { Check, Copy, Gift, Share2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

/**
 * Referral card (operator spec 2026-07-24): the code is displayed, and one
 * action copies a paste-ready INVITE — a short message plus the signup link
 * with the code in it (`/signup?ref=CODE`), which the signup form reads,
 * auto-fills and locks. On devices with a native share sheet the button
 * opens it instead, which on this platform's audience means straight into
 * WhatsApp.
 *
 * Old-device support, most-capable path first, no dead ends:
 *   1. navigator.share        (mobile share sheet; https + user gesture)
 *   2. navigator.clipboard    (modern browsers, secure contexts)
 *   3. document.execCommand   (deprecated everywhere, WORKS everywhere —
 *                              the KaiOS/Android-Go fallback)
 */
export function ReferralCard({ code }: { code: string | null }) {
  const t = useTranslations('dashboard.referral')

  const [state, setState] = useState<'idle' | 'copied' | 'shared'>('idle')
  const [canShare, setCanShare] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // navigator.share is probed on mount, not during render: SSR has no
  // navigator, and hydration must match the server markup.
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  if (!code) return null

  const inviteUrl = () => `${window.location.origin}/signup?ref=${code}`
  const inviteText = () => t('inviteMessage', { url: inviteUrl() })

  const flash = (next: 'copied' | 'shared') => {
    setState(next)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState('idle'), 2000)
  }

  const copyFallback = (text: string) => {
    // execCommand needs a real, focused, in-DOM textarea. Ugly and reliable.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(ta)
    return ok
  }

  const share = async () => {
    const text = inviteText()

    if (canShare) {
      try {
        await navigator.share({ text })
        flash('shared')
        return
      } catch (err) {
        // AbortError = the user closed the sheet; that is not a failure and
        // must not dump the text on their clipboard uninvited.
        if (err instanceof Error && err.name === 'AbortError') return
        // Anything else: fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(text)
      flash('copied')
    } catch {
      if (copyFallback(text)) flash('copied')
    }
  }

  return (
    <div className="rounded-(--radius-card) border border-orange-500/25 bg-orange-50 p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-orange-700">
            <Gift aria-hidden className="size-3.5" />
            {t('title')}
          </p>
          <p className="mt-2 font-mono text-[1.25rem] font-bold tracking-[0.14em] text-ink-900">
            {code}
          </p>
          <p className="mt-1 text-[0.75rem] leading-snug text-ink-500">{t('hint')}</p>
        </div>

        <button
          type="button"
          onClick={share}
          aria-live="polite"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold',
            'transition-[background-color,border-color,color,transform] duration-150 active:scale-95',
            'pointer-coarse:px-3.5 pointer-coarse:py-2',
            state === 'idle'
              ? 'border-orange-500/40 bg-surface text-orange-700 hover:border-orange-600'
              : 'border-success-500/40 bg-success-50 text-success-700',
          )}
        >
          {state === 'idle' ? (
            <>
              {canShare ? (
                <Share2 aria-hidden className="size-3.5" />
              ) : (
                <Copy aria-hidden className="size-3.5" />
              )}
              {canShare ? t('share') : t('copy')}
            </>
          ) : (
            <>
              <Check aria-hidden className="size-3.5" />
              {state === 'shared' ? t('sharedDone') : t('copiedDone')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
