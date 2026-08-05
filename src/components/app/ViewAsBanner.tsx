import { getTranslations } from 'next-intl/server'
import { Eye, X } from 'lucide-react'

/**
 * The bar that says whose account is on screen.
 *
 * Deliberately loud, deliberately unmissable, and deliberately at the very top
 * of every signed-in screen. Two reasons, and the second is the important one:
 *
 *   1. An admin who forgets they are viewing somebody else will read that
 *      person's balance as their own, or screenshot it into a support thread.
 *   2. Everything is read-only, so a button that quietly does nothing is worse
 *      than a button that is absent. The banner is what explains the silence
 *      when a tap has no effect.
 *
 * `position: sticky` rather than fixed: fixed would sit over the content on a
 * short screen, and this app's bottom tab bar already owns the bottom edge.
 */
export async function ViewAsBanner({ name }: { name: string }) {
  const t = await getTranslations('viewAs')

  return (
    <div className="sticky top-0 z-50 bg-warning-500 text-[#1c1204]">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        <Eye aria-hidden className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-tight font-medium">
          <span className="font-semibold">{t('viewing', { name })}</span>
          <span className="ml-1.5 opacity-80">{t('readOnly')}</span>
        </p>
        {/*
          A plain link, not a form. Ending the look is a GET to /api, which is
          the one path the read-only middleware block does not cover — a submit
          button here would be refused by the block it is meant to lift.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
            A FULL DOCUMENT LOAD IS THE POINT. `next/link` does a client
            transition and reuses the router cache built while the viewing
            cookie was still set, so the app would keep rendering the other
            person's screens after the look has ended. A plain anchor throws
            that cache away along with the cookie. */}
        <a
          href="/api/impersonate/stop"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1c1204]/12 px-3 py-1.5 text-[0.75rem] font-semibold transition-colors hover:bg-[#1c1204]/20"
        >
          <X aria-hidden className="size-3.5" />
          {t('exit')}
        </a>
      </div>
    </div>
  )
}
