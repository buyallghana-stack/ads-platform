'use client'

import { useState, useTransition } from 'react'

import { Check, Download, Link2, Loader2, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { setCertificateName } from '@/app/[locale]/(affiliate)/market/certificate/[productId]/actions'
import { cn } from '@/lib/cn'

/**
 * The name gate, and then the certificate with its two buttons.
 *
 * ── WHY THE SHEET IS A PROP ──
 *
 * It is a SERVER component: it renders a QR that was generated on the server
 * and it holds no state at all. Passing it in as a node keeps it that way,
 * while this component owns the one interactive thing on the page — whether a
 * legal name has been given yet.
 *
 * ── DOWNLOAD IS `window.print()` ──
 *
 * Which on every phone and desktop browser offers "Save as PDF", and prints at
 * the device's own resolution. The alternative was a PDF library on the server
 * rendering a second copy of this layout in a different engine, which is two
 * designs to keep identical and a certificate that looks subtly wrong the
 * first time they drift.
 */
export function CertificateActions({
  productId,
  legalName,
  verifyUrl,
  sheet,
}: {
  productId: string
  legalName: string | null
  verifyUrl: string
  sheet: React.ReactNode
}) {
  const t = useTranslations('affiliate.certificate')
  const [name, setName] = useState(legalName ?? '')
  const [saved, setSaved] = useState(legalName)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    start(async () => {
      const result = await setCertificateName(productId, name)
      if (!result.ok) return setError(result.message)
      setSaved(result.legalName)
    })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* Clipboard blocked. The link is printed on the sheet as a QR anyway. */
    }
  }

  if (!saved) {
    return (
      <section className="print:hidden mt-5 rounded-(--radius-panel) border border-ink-200 bg-surface p-5 sm:p-6">
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-full bg-brand-600/12 text-brand-700"
        >
          <ShieldCheck className="size-5" />
        </span>
        <h2 className="mt-3 text-[1rem] font-semibold text-ink-900">{t('nameTitle')}</h2>
        <p className="mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-ink-500">
          {t('nameBody')}
        </p>

        <form onSubmit={submit} className="mt-4 max-w-md">
          <label htmlFor="legal-name" className="text-[0.8125rem] font-medium text-ink-700">
            {t('nameLabel')}
          </label>
          <input
            id="legal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder={t('namePlaceholder')}
            className="mt-1.5 h-12 w-full rounded-(--radius-input) border border-ink-200 bg-surface px-3.5 text-[0.9375rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:shadow-[0_0_0_3px] focus:shadow-brand-600/12 focus:outline-none"
          />
          <p className="mt-1.5 text-[0.75rem] text-ink-500">{t('nameHint')}</p>

          {error && (
            <p className="mt-2.5 rounded-(--radius-input) border border-danger-500/25 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || name.trim().length < 3}
            className="mt-4 inline-flex items-center gap-2 rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
          >
            {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {t('nameSubmit')}
          </button>
        </form>
      </section>
    )
  }

  return (
    <>
      <div className="mt-5">{sheet}</div>

      <div className="print:hidden mt-5 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-(--radius-input) bg-brand-600 px-4 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-500"
        >
          <Download aria-hidden className="size-4" />
          {t('download')}
        </button>

        <button
          type="button"
          onClick={copy}
          className={cn(
            'inline-flex items-center gap-2 rounded-(--radius-input) border px-4 py-2.5',
            'text-[0.875rem] font-semibold transition-colors',
            copied
              ? 'border-success-500/40 bg-success-50 text-success-600'
              : 'border-ink-200 text-ink-800 hover:border-ink-300',
          )}
        >
          {copied ? <Check aria-hidden className="size-4" /> : <Link2 aria-hidden className="size-4" />}
          {copied ? t('copied') : t('share')}
        </button>
      </div>

      <p className="print:hidden mt-3 text-[0.75rem] leading-relaxed text-ink-500">
        {t('printHint')}
      </p>
    </>
  )
}
