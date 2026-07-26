import { getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { LanguageToggle } from '@/components/profile/LanguageToggle'
import { Link } from '@/i18n/navigation'

/**
 * Landing-page footer.
 *
 * Every link here goes somewhere that exists — the four anchors on this page,
 * the two auth routes, and the two published legal documents. A footer padded
 * out with About / Careers / Blog links that 404 is the fastest way to make a
 * real product look like a template.
 */
/** Bumped by hand. `new Date()` in a Server Component trips the purity lint
 *  rule, and on a statically rendered page it would freeze at build time
 *  anyway — so an honest constant beats a fake computation. */
/** A STRING, not a number: next-intl formats numeric ICU arguments, which
 *  would render the year as "2,026". */
const COPYRIGHT_YEAR = '2026'

export async function MarketingFooter() {
  const t = await getTranslations('landing.footer')
  const tNav = await getTranslations('landing.nav')

  const groups = [
    {
      title: t('product'),
      links: [
        { href: '#how', label: tNav('how'), external: false },
        { href: '#earning', label: tNav('earning'), external: false },
        { href: '#plans', label: tNav('plans'), external: false },
        { href: '#invite', label: tNav('invite'), external: false },
      ],
    },
    {
      title: t('account'),
      links: [
        { href: '/signup', label: tNav('signup'), external: true },
        { href: '/login', label: tNav('login'), external: true },
        { href: '#faq', label: tNav('faq'), external: false },
      ],
    },
    {
      title: t('legal'),
      links: [
        { href: '/terms', label: t('terms'), external: true },
        { href: '/privacy', label: t('privacy'), external: true },
      ],
    },
  ]

  return (
    <footer className="border-t border-ink-200 bg-surface px-4 py-12 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-[76rem]">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between lg:gap-16">
          <div className="max-w-sm">
            <Logo variant="dark" />
            <p className="mt-4 text-sm leading-relaxed text-ink-600">{t('blurb')}</p>
            <div className="mt-5">
              <LanguageToggle />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:gap-14">
            {groups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-500 uppercase">
                  {group.title}
                </h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      {link.external ? (
                        <Link
                          href={link.href}
                          className="text-sm text-ink-600 transition-colors hover:text-ink-900"
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          className="text-sm text-ink-600 transition-colors hover:text-ink-900"
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">{t('copyright', { year: COPYRIGHT_YEAR })}</p>
          <p className="text-xs text-ink-500">{t('madeIn')}</p>
        </div>
      </div>
    </footer>
  )
}
