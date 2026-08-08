import { Award, Download } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import type { EarnedCertificate } from '@/lib/market/data'

/**
 * The certificates somebody has earned, on the profile.
 *
 * ── WHY NOT ON LEARN ──
 *
 * Operator, 2026-08-08. Learn is a list of courses in three states, and a
 * certificate is not a course — it is a document you hold afterwards. Keeping
 * it there meant a finished course vanished from the course list and came back
 * as a trophy, so somebody wanting to re-read lesson four of a course they had
 * completed had nowhere obvious to go.
 *
 * The profile is where the other things you HOLD live: your payout account,
 * your affiliate code, your training. A certificate belongs with those.
 */
export async function CertificatesPanel({
  certificates,
}: {
  certificates: EarnedCertificate[]
}) {
  const t = await getTranslations('affiliate.certificatesPanel')
  const format = await getFormatter()

  if (certificates.length === 0) return null

  return (
    <section className="rounded-(--radius-panel) border border-ink-200 bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-success-500/15 text-success-600"
        >
          <Award className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold text-ink-900">{t('title')}</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-500">{t('body')}</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {certificates.map((certificate) => (
          <li
            key={certificate.id}
            className="rounded-(--radius-card) border border-success-500/25 bg-success-50 p-3.5"
          >
            <p className="text-[0.875rem] font-semibold text-ink-900">{certificate.title}</p>
            <p className="mt-0.5 text-[0.75rem] text-ink-600">
              {t('issued', {
                date: format.dateTime(new Date(certificate.issuedAt), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }),
              })}
            </p>
            {/* Null means no grade was recorded, never a grade of zero. */}
            {certificate.grade !== null && (
              <p className="mt-1 text-[0.75rem] font-semibold tabular-nums text-success-700">
                {t('grade', { n: certificate.grade })}
              </p>
            )}
            <p className="mt-1 font-mono text-[0.6875rem] text-ink-500">{certificate.code}</p>

            <Link
              href={`/market/certificate/${certificate.productId}`}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-(--radius-input) bg-success-600 px-3 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-success-700"
            >
              <Download aria-hidden className="size-4" />
              {t('view')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
