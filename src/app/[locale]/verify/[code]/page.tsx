import type { Metadata } from 'next'

import { BadgeCheck, XCircle } from 'lucide-react'
import { setRequestLocale } from 'next-intl/server'

import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Verify a certificate',
  robots: { index: false, follow: false },
}

/**
 * Checking that a certificate is real. The QR on every sheet points here.
 *
 * ── PUBLIC, AND DELIBERATELY THIN ──
 *
 * No sign-in: the person checking is an employer or a buyer, not a user, and
 * a verification page behind a login is a verification page nobody uses.
 *
 * `certificate_by_code` returns the document and nothing else — no email, no
 * user id, no phone. The code is the credential, so anybody holding it can see
 * what the certificate says; that is the entire point. What they must not get
 * is a way to turn a collected code into a person's contact details.
 */
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>
}) {
  const { locale, code } = await params
  setRequestLocale(locale)

  const supabase = createAdminClient()
  const { data } = await supabase.rpc('certificate_by_code', { p_code: code })
  const cert = data as unknown as {
    code: string
    holder: string
    course: string
    grade: number | null
    issued_at: string
  } | null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
      {cert ? (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center sm:p-8">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-full bg-success-50 text-success-600"
          >
            <BadgeCheck className="size-7" />
          </span>
          <p className="mt-3 text-[0.8125rem] font-medium uppercase tracking-wide text-success-600">
            Genuine certificate
          </p>

          <h1 className="mt-3 text-[1.5rem] font-semibold tracking-[-0.02em] text-ink-900">
            {cert.holder}
          </h1>
          <p className="mt-1 text-[0.9375rem] text-ink-600">{cert.course}</p>

          <dl className="mt-5 divide-y divide-ink-100 border-y border-ink-100 text-left">
            {[
              cert.grade !== null ? { k: 'Grade', v: `${cert.grade}%` } : null,
              {
                k: 'Issued',
                v: new Intl.DateTimeFormat(locale, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                }).format(new Date(cert.issued_at)),
              },
              { k: 'Reference', v: cert.code },
            ]
              .filter((row) => row !== null)
              .map((row) => (
                <div key={row.k} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-[0.8125rem] text-ink-500">{row.k}</dt>
                  <dd className="text-[0.875rem] font-semibold tabular-nums text-ink-900">
                    {row.v}
                  </dd>
                </div>
              ))}
          </dl>

          <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-500">
            Issued by SidePerks Ghana. This page is the record; a printed copy that does not
            match it is not genuine.
          </p>
        </div>
      ) : (
        <div className="rounded-(--radius-panel) border border-ink-200 bg-surface p-6 text-center sm:p-8">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-full bg-danger-50 text-danger-700"
          >
            <XCircle className="size-7" />
          </span>
          <h1 className="mt-3 text-[1.25rem] font-semibold text-ink-900">No such certificate</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[0.875rem] leading-relaxed text-ink-500">
            Nothing on SidePerks carries the reference <strong>{code}</strong>. Check the code and
            try again.
          </p>
        </div>
      )}
    </main>
  )
}
