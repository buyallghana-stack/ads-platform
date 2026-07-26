import type { Metadata } from 'next'
import { Instrument_Serif, Inter } from 'next/font/google'
import { notFound } from 'next/navigation'

import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { routing } from '@/i18n/routing'

import '../globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

/**
 * Display serif, used for exactly one thing: the italic accent word inside a
 * marketing headline. It is a single weight in a single style, so it costs one
 * small extra file and only on pages that actually set `font-display` — the
 * signed-in app never renders a character of it.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-instrument-serif',
  display: 'swap',
})

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'common' })

  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: 'Watch ads, answer a question, earn points you can cash out.',
    // Ghana only (§6.9). No reason to invite indexing from anywhere yet.
    robots: { index: false, follow: false },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  // Required for static rendering to resolve the right locale.
  setRequestLocale(locale)

  return (
    // suppressHydrationWarning: next-themes writes the resolved theme class
    // onto <html> before React hydrates, so the server/client class lists
    // differ by design on the first paint.
    <html
      lang={locale}
      className={`${inter.variable} ${instrumentSerif.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        <ThemeProvider>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
