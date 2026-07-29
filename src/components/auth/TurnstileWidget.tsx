'use client'

import { useEffect, useRef } from 'react'

/**
 * The Turnstile widget, rendered only when a site key exists.
 *
 * Renders NOTHING at all when the key is unset, so the signup form is exactly
 * what it was before this shipped — no empty box, no layout shift, no "loading
 * security check" that never finishes. See `turnstile.ts` for why the whole
 * feature is opt-in on the presence of keys.
 *
 * The script is loaded once and shared: two widgets on one page (there are
 * not, but a future password-reset one is plausible) must not each fetch it.
 */

const SCRIPT_ID = 'cf-turnstile-script'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
      reset: (id: string) => void
    }
  }
}

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
  if (existing) {
    return new Promise((resolve) => existing.addEventListener('load', () => resolve(), { once: true }))
  }

  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    // Resolves on error too: a blocked script must leave the form usable, and
    // the server is what actually decides whether a token was required.
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => resolve(), { once: true })
    document.head.appendChild(script)
  })
}

/** What the app is actually showing right now, not what the OS prefers. */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function TurnstileWidget({
  siteKey,
  onToken,
  theme = 'auto',
  resetSignal = 0,
}: {
  /** Absent when the operator has not set one — the component renders null. */
  siteKey?: string
  onToken: (token: string | undefined) => void
  theme?: 'auto' | 'light' | 'dark'
  /**
   * Bump this to make the challenge issue a NEW token.
   *
   * A Turnstile token is SINGLE USE. Any submit that reaches the server spends
   * it, so after a failed attempt the one in the form's hand is already dead
   * and every retry is refused as a duplicate — with the widget still showing
   * "Success", because nothing asked it to run again. That is a form that
   * locks itself on the first error and only a full page reload can clear.
   * Reported from production on 2026-07-29.
   */
  resetSignal?: number
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)
  /* The callback changes identity on every render of the parent form. Kept in
     a ref so the effect below depends only on the key — re-rendering the whole
     widget on each keystroke would reset the challenge under the user.

     Synced in an effect, not during render: writing to a ref while rendering
     is the thing `react-hooks` rightly refuses, because a render that React
     throws away would still have mutated it. */
  const callback = useRef(onToken)
  useEffect(() => {
    callback.current = onToken
  }, [onToken])

  // Fresh token on demand. Separate from the render effect below so a reset
  // re-runs the challenge in place rather than tearing the widget down.
  useEffect(() => {
    if (!resetSignal || !widgetId.current || !window.turnstile) return
    try {
      window.turnstile.reset(widgetId.current)
    } catch {
      // Widget already gone; the render effect will make a new one.
    }
  }, [resetSignal])

  useEffect(() => {
    if (!siteKey || !box.current) return
    let cancelled = false

    loadScript().then(() => {
      if (cancelled || !box.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(box.current, {
        sitekey: siteKey,
        /*
          Cloudflare's own `auto` follows the OPERATING SYSTEM, while this app
          follows next-themes — so somebody who chose Dark on a light phone got
          a white challenge box in a dark form.

          Resolved from the DOM class here rather than from `useTheme()` on
          purpose: the hook returns undefined until it has mounted, and feeding
          that to the effect would tear down and re-render the challenge on
          every page load. The class is already on <html> by this point,
          written by the no-flash script before paint.
        */
        theme: theme === 'auto' ? currentTheme() : theme,
        callback: (token: string) => callback.current(token),
        // A token is single-use and short-lived. When it expires or the
        // challenge errors, clear it so the form asks again rather than
        // submitting something the server will reject.
        'expired-callback': () => callback.current(undefined),
        'error-callback': () => callback.current(undefined),
      })
    })

    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current)
        } catch {
          // Already gone with the DOM node.
        }
      }
    }
  }, [siteKey, theme])

  if (!siteKey) return null

  return <div ref={box} className="flex justify-center" />
}
