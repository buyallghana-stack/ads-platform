import { ArrowLeft, Info } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { getLegalDoc, LEGAL_REVIEWED, type LegalKind } from '@/content/legal'
import { Link } from '@/i18n/navigation'
import { getSessionUser } from '@/lib/auth/session'

/**
 * Renders a legal document from structured content.
 *
 * Long documents are read by people looking for one clause, so this leads with
 * a contents list of anchored sections rather than making them scroll. Body
 * text is capped at a comfortable measure and set at a size meant to be read,
 * not skimmed past.
 *
 * While LEGAL_REVIEWED is false the page carries a visible notice that the
 * wording is a draft. Presenting unreviewed text as binding is the one thing
 * these pages must not do.
 *
 * WHERE "BACK" GOES DEPENDS ON WHO IS READING (operator, 2026-07-31). These
 * pages are reached from two very different places: the signup form, by
 * somebody who has no account yet, and the Profile tab, by somebody who does.
 * Sending a signed-in user to the marketing landing page drops them out of the
 * app they were using, so they now return to their Home tab. A signed-out
 * reader still goes to the landing page — /dashboard would only bounce them to
 * /login, which is a worse dead end than the one being fixed.
 */
export async function LegalDocument({
  kind,
  locale,
}: {
  kind: LegalKind
  locale: string
}) {
  const doc = getLegalDoc(kind, locale)
  const t = await getTranslations('legal')
  const format = await getFormatter()

  const user = await getSessionUser()
  const home = user ? '/dashboard' : '/'

  return (
    <div className="flex min-h-dvh flex-col items-center bg-canvas px-5 py-10 sm:px-8">
      <div className="w-full max-w-2xl">
        <Link href={home} className="inline-flex">
          <Logo variant="dark" />
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-ink-900">{doc.title}</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">
          {t('updated', {
            date: format.dateTime(new Date(doc.updated), {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </p>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-700">{doc.summary}</p>

        {!LEGAL_REVIEWED && (
          <div className="mt-5 flex items-start gap-3 rounded-(--radius-card) border border-warning-500/25 bg-warning-50 px-4 py-3.5">
            <Info aria-hidden className="mt-0.5 size-4.5 shrink-0 text-warning-600" />
            <p className="text-[0.8125rem] leading-relaxed text-warning-700">{t('draftNotice')}</p>
          </div>
        )}

        {/* Contents ---------------------------------------------------- */}
        <nav aria-label={t('contents')} className="mt-7 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
          <p className="text-[0.75rem] font-semibold tracking-[0.04em] text-ink-500 uppercase">
            {t('contents')}
          </p>
          <ol className="mt-2.5 flex flex-col gap-1.5">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-[0.8125rem] leading-snug text-ink-600 underline-offset-2 transition-colors hover:text-brand-700 hover:underline"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Body -------------------------------------------------------- */}
        <div className="mt-8 flex flex-col gap-8">
          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-6">
              <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-900">
                {section.heading}
              </h2>
              <div className="mt-2.5 flex flex-col gap-3">
                {section.blocks.map((block, index) => {
                  if (block.kind === 'p') {
                    return (
                      <p key={index} className="text-[0.9375rem] leading-relaxed text-ink-700">
                        {block.text}
                      </p>
                    )
                  }
                  if (block.kind === 'list') {
                    return (
                      <ul key={index} className="flex flex-col gap-1.5 pl-1">
                        {block.items.map((item) => (
                          <li
                            key={item}
                            className="flex gap-2.5 text-[0.9375rem] leading-relaxed text-ink-700"
                          >
                            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-300" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                  return (
                    <p
                      key={index}
                      className="rounded-(--radius-card) border border-brand-600/20 bg-brand-50 px-4 py-3 text-[0.875rem] leading-relaxed text-ink-800"
                    >
                      {block.text}
                    </p>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <Link
          href={home}
          className="mt-10 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 hover:text-brand-700"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {t('backHome')}
        </Link>
      </div>
    </div>
  )
}
