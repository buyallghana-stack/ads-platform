import type { Metadata } from 'next'

import { notFound } from 'next/navigation'

import { ArrowLeft } from 'lucide-react'
import QRCode from 'qrcode'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { CertificateActions } from '@/components/affiliate/CertificateActions'
import { CertificateSheet } from '@/components/affiliate/CertificateSheet'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Certificate',
  robots: { index: false, follow: false },
}

type Certificate = {
  code: string
  legal_name: string | null
  holder: string
  course: string
  level: 'beginner' | 'professional' | null
  grade: number | null
  issued_at: string
}

/**
 * A certificate, ready to download.
 *
 * ── THE LEGAL NAME IS ASKED FOR FIRST ──
 *
 * Operator direction: somebody has to enter their legal name before they can
 * download. The account's display name is very often a first name or a
 * nickname, and a certificate reading "Kwame" is not a document anybody can
 * present. So the sheet renders behind a form until a name with at least two
 * words has been given, and that name is frozen onto the certificate rather
 * than read live from the profile — a document already downloaded and shared
 * must not change because somebody edited their profile afterwards.
 *
 * ── THE QR IS RENDERED ON THE SERVER ──
 *
 * As a data URI, so the sheet has no network dependency at print time. A QR
 * fetched by the browser is a QR that prints as a broken image on a bad
 * connection, and this page's whole job is to be printed.
 */
export default async function CertificatePage({
  params,
}: {
  params: Promise<{ locale: string; productId: string }>
}) {
  const { locale, productId } = await params
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })

  const t = await getTranslations('affiliate.certificate')
  const supabase = createAdminClient()
  const { data } = await supabase.rpc('my_certificate', {
    p_user_id: user!.id,
    p_product_id: productId,
  })

  const certificate = data as unknown as Certificate | null
  if (!certificate) notFound()

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sideperks.org'
  const verifyUrl = `${origin}/verify/${certificate.code}`
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 0,
    width: 320,
    color: { dark: '#1f2430ff', light: '#00000000' },
  }).catch(() => null)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 md:py-7">
      <Link
        href="/learn"
        className="print:hidden mb-4 inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      <div className="print:hidden">
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-900">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-[0.8125rem] text-ink-500">{t('subtitle')}</p>
      </div>

      <CertificateActions
        productId={productId}
        legalName={certificate.legal_name}
        verifyUrl={verifyUrl}
        sheet={
          <CertificateSheet
            holder={certificate.legal_name ?? certificate.holder}
            course={certificate.course}
            level={certificate.level}
            grade={certificate.grade}
            issuedAt={certificate.issued_at}
            code={certificate.code}
            qrDataUrl={qrDataUrl}
            locale={locale}
          />
        }
      />
    </div>
  )
}
