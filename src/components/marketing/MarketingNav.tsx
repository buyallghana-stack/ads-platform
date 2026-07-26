'use client'

import { useEffect, useState } from 'react'

import { Menu, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Logo } from '@/components/brand/Logo'
import { ThemeSwitchButton } from '@/components/theme/ThemeSwitchButton'
import { Button } from '@/components/ui/Button'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/cn'

/**
 * Sticky marketing header.
 *
 * The operator's one hard requirement for this page: the logo and the menu
 * stay visible the whole way down. So the header is `sticky top-0`, not a
 * banner that scrolls away and not a `fixed` bar that needs the page padded
 * to compensate — sticky keeps it in flow, so nothing hides under it and the
 * anchor links land where they should (`scroll-padding-top` in globals.css
 * already reserves the header's height for that).
 *
 * TWO POSITIONING TRAPS ARE DESIGNED AROUND HERE, both previously paid for
 * elsewhere in this codebase:
 *
 *   1. `backdrop-blur` sits on the INNER bar, never on <header> itself. A
 *      filtered element becomes the containing block for its `fixed`
 *      descendants, so a blurred <header> would trap the full-screen mobile
 *      sheet inside a 64px-tall box. Keeping the filter one level down leaves
 *      `fixed` resolving against the viewport, where it belongs.
 *   2. The bar is translucent, so it needs a real backdrop behind it — a
 *      transparent header over scrolling text is unreadable. `bg-surface/85`
 *      plus a hairline gives it an edge in both themes.
 */

/** Anchors into the page. Kept in one list so the desktop row and the mobile
 *  sheet cannot drift apart. */
const LINKS = [
  { href: '#how', key: 'how' },
  { href: '#earning', key: 'earning' },
  { href: '#plans', key: 'plans' },
  { href: '#invite', key: 'invite' },
  { href: '#faq', key: 'faq' },
] as const

export function MarketingNav() {
  const t = useTranslations('landing.nav')
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // A hairline from the first pixel of scroll, and none at the very top —
  // the header should read as part of the hero until the page moves under it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // The sheet covers the page, so the page behind it must not scroll — on
  // iOS a scrolling body under a fixed overlay is how you lose your place.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  // Escape closes it, like every other dismissible layer in this app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="sticky top-0 z-50">
      <div
        className={cn(
          'bg-surface/85 backdrop-blur-md transition-[border-color,box-shadow] duration-200',
          'border-b',
          scrolled
            ? 'border-ink-200 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]'
            : 'border-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-[76rem] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="shrink-0 rounded-(--radius-input)" aria-label="SidePerks">
            <Logo variant="dark" />
          </Link>

          {/* Centre row. Appears only where five items plus two buttons fit
              without crushing; below that they live in the sheet. */}
          <nav
            aria-label={t('primary')}
            className="mx-auto hidden items-center gap-1 lg:flex"
          >
            {LINKS.map((l) => (
              <a
                key={l.key}
                href={l.href}
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                {t(l.key)}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <ThemeSwitchButton />

            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" size="sm">
                {t('login')}
              </Button>
            </Link>

            <Link href="/signup" className="hidden sm:block">
              <Button size="sm">{t('signup')}</Button>
            </Link>

            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t('openMenu')}
              aria-expanded={open}
              className="grid size-10 place-items-center rounded-(--radius-input) border border-ink-200 bg-surface text-ink-700 transition-colors hover:bg-ink-50 lg:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Full-screen sheet rather than a dropdown: at 360px a dropdown with
          five links and two buttons fills the screen anyway, and a sheet gets
          a proper close target and no scrim-tap ambiguity. */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-canvas lg:hidden">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-surface px-4 sm:px-6">
            <Logo variant="dark" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('closeMenu')}
              autoFocus
              className="ml-auto grid size-10 place-items-center rounded-(--radius-input) border border-ink-200 bg-surface text-ink-700 transition-colors hover:bg-ink-50"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>

          <nav aria-label={t('primary')} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <ul className="flex flex-col">
              {LINKS.map((l) => (
                <li key={l.key}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center border-b border-ink-200 py-4 text-lg font-medium text-ink-900"
                  >
                    {t(l.key)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="shrink-0 border-t border-ink-200 bg-surface px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="flex flex-col gap-2">
              <Link href="/signup" onClick={() => setOpen(false)}>
                <Button size="lg" fullWidth>
                  {t('signup')}
                </Button>
              </Link>
              <Link href="/login" onClick={() => setOpen(false)}>
                <Button variant="secondary" size="lg" fullWidth>
                  {t('login')}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
