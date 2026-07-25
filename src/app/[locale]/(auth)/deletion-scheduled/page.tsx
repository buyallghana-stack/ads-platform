import type { Metadata } from 'next'

import { CalendarClock, LogIn, RotateCcw } from 'lucide-react'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { FormHeader } from '@/components/auth/FormHeader'
import { Link } from '@/i18n/navigation'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'deletionScheduled' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Shown right after a deletion is requested — and deliberately PUBLIC, because
 * requesting deletion signs the user out. It exists to leave one thing in the
 * user's head: signing in cancels this.
 *
 * The date arrives in the URL because there is no session left to read it
 * from. It is display-only; the real date lives on the profile and is what the
 * scheduled job acts on, so editing the parameter changes nothing.
 */
export default async function DeletionScheduledPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ on?: string }>
}) {
  const { locale } = await params
  const { on } = await searchParams
  setRequestLocale(locale)

  const t = await getTranslations('deletionScheduled')
  const format = await getFormatter()

  const when = on ? new Date(on) : null
  const dateLabel =
    when && !Number.isNaN(when.getTime())
      ? format.dateTime(when, { day: 'numeric', month: 'long', year: 'numeric' })
      : null

  return (
    <AuthLayout compact>
      <div className="flex flex-col">
        <FormHeader
          icon={<CalendarClock aria-hidden className="size-5" />}
          title={t('title')}
          subtitle={dateLabel ? t('subtitleDated', { date: dateLabel }) : t('subtitle')}
        />

        <div className="mt-7 flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-(--radius-card) border border-success-500/25 bg-success-50 px-4 py-3.5">
            <RotateCcw aria-hidden className="mt-0.5 size-5 shrink-0 text-success-600" />
            <div>
              <p className="text-[0.8125rem] font-semibold text-success-700">{t('cancel.title')}</p>
              <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-success-700/85">
                {t('cancel.body')}
              </p>
            </div>
          </div>

          <div className="rounded-(--radius-card) border border-ink-200 bg-surface px-4 py-3.5">
            <p className="text-[0.8125rem] font-semibold text-ink-900">{t('after.title')}</p>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-600">{t('after.body')}</p>
          </div>
        </div>

        <Link
          href="/login"
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-input) border border-brand-700 bg-brand-600 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          <LogIn aria-hidden className="size-4" />
          {t('signInCta')}
        </Link>
      </div>
    </AuthLayout>
  )
}
