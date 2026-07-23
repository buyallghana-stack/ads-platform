import { ArrowLeft, FileText } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { Card, CardBody } from '@/components/ui/Card'
import { Link } from '@/i18n/navigation'

/**
 * Placeholder for the Terms and Privacy documents.
 *
 * These are linked from the sign-up consent checkbox, so a 404 there is worse
 * than a placeholder — it looks like the links are broken on a product asking
 * people to agree to something.
 *
 * The copy states plainly that the document is not published rather than
 * showing invented legal text. Drafting terms for a platform that will move
 * real money under a licence is the operator's job with their lawyer, and
 * placeholder legalese has a way of surviving to launch.
 */
export async function LegalPending({ titleKey }: { titleKey: 'terms' | 'privacy' }) {
  const t = await getTranslations('legal')

  return (
    <div className="flex min-h-dvh flex-col items-center bg-canvas px-5 py-10 sm:px-8">
      <div className="w-full max-w-xl">
        <Link href="/signup" className="inline-flex">
          <Logo variant="dark" />
        </Link>

        <h1 className="mt-8 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {t(`${titleKey}.title`)}
        </h1>

        <Card className="mt-4">
          <CardBody className="flex gap-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-input) border border-ink-200 bg-ink-50 text-ink-500">
              <FileText aria-hidden className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink-900">{t('pendingTitle')}</h2>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-600">
                {t('pendingBody')}
              </p>
              <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-500">
                {t.rich('pendingContact', {
                  email: 'buyallghana@gmail.com',
                  em: (chunks) => (
                    <a
                      href="mailto:buyallghana@gmail.com"
                      className="font-medium text-ink-900 underline underline-offset-2 hover:text-brand-700"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
          </CardBody>
        </Card>

        <Link
          href="/signup"
          className="mt-5 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {t('back')}
        </Link>
      </div>
    </div>
  )
}
