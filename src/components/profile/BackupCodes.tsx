'use client'

import { useState } from 'react'

import { Check, Copy, Download, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'

/**
 * The one and only time a user sees their backup codes.
 *
 * Three ways out of this screen, because "write these down" fails differently
 * on different devices: copy (fine on a laptop), download (a file they still
 * have after the tab closes), or simply reading them off the grid. The codes
 * are monospace and dash-grouped so they can be transcribed by hand without
 * the 0/O and 1/l confusion — the alphabet already excludes those characters.
 *
 * Continuing is gated behind an explicit acknowledgement. It is the only
 * moment where a careless tap costs the user their recovery path.
 */
export function BackupCodes({
  codes,
  onDone,
  doneLabel,
}: {
  codes: string[]
  onDone: () => void
  doneLabel: string
}) {
  const t = useTranslations('twoFactor.codes')
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const asText = codes.join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Older WebViews with no clipboard API: the codes are on screen and
      // downloadable, so this is a convenience, never the only route.
      setCopied(false)
    }
  }

  const download = () => {
    const blob = new Blob([`${t('fileHeading')}\n\n${asText}\n`], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sideperks-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="animate-rise mt-6 flex flex-col">
      <div className="flex items-start gap-3 rounded-(--radius-card) border border-warning-500/25 bg-warning-50 px-4 py-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning-600" />
        <p className="text-[0.8125rem] leading-relaxed text-warning-700">{t('warning')}</p>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-(--radius-card) border border-ink-200 bg-surface p-4">
        {codes.map((code) => (
          <li
            key={code}
            className="text-center font-mono text-[0.875rem] tracking-[0.04em] text-ink-900 tabular-nums"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" size="sm" onClick={copy} className="flex-1">
          {copied ? (
            <>
              <Check aria-hidden className="size-4" />
              {t('copied')}
            </>
          ) : (
            <>
              <Copy aria-hidden className="size-4" />
              {t('copy')}
            </>
          )}
        </Button>
        <Button variant="secondary" size="sm" onClick={download} className="flex-1">
          <Download aria-hidden className="size-4" />
          {t('download')}
        </Button>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded-[0.25rem] border-ink-300 text-brand-600 focus:ring-2 focus:ring-brand-600 focus:ring-offset-1"
        />
        <span className="text-[0.8125rem] leading-relaxed text-ink-700">{t('acknowledge')}</span>
      </label>

      <Button size="lg" fullWidth className="mt-4" disabled={!acknowledged} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}
