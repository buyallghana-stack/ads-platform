'use client'

import { useMemo, useState } from 'react'

import { Download } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { EmptyState, TableShell, Toolbar } from '@/components/admin/AdminTable'
import { useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/cn'
import type { AdResponseRow, ResponsesScreenData } from '@/lib/admin/responses-data'

/**
 * Survey answers, on screen and as a CSV.
 *
 * Operator, 2026-08-12: *"i want that in CSV report where at anytime i can
 * download them and see responses so far."* Both halves matter — the table is
 * for a glance, the file is for the advertiser — so the screen shows the
 * answers and the button hands over the same rows.
 *
 * ── THE FILE IS BUILT IN THE BROWSER ──
 *
 * Same as the vendor settlement report: the rows are already on this page, so
 * assembling the CSV here means no download endpoint exists to be found,
 * guessed at, or left unguarded. Nothing is fetched when the button is
 * pressed.
 *
 * ⚠️ THE FILE NAMES PEOPLE. Every row carries a respondent's name and phone
 * number by the operator's decision, so it is personal data the moment it
 * leaves this screen. The note under the table says so, because the person
 * about to email it to an advertiser is the person who needs telling.
 */
export function ResponsesReport({ data }: { data: ResponsesScreenData }) {
  const t = useTranslations('admin.responses')
  const format = useFormatter()
  const router = useRouter()
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data.rows
    return data.rows.filter((r) =>
      [r.respondent, r.phone ?? '', r.questionText, r.answer ?? '', r.adTitle]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [data.rows, query])

  const download = () => {
    const header = [
      'Answered at',
      'Ad',
      'Format',
      'Question #',
      'Question',
      'Answer',
      'Correct',
      'Graded',
      'Occasion',
      'Attempt',
      'Seconds watched',
      'Respondent',
      'Phone',
      'Plan',
      'Points paid',
      'Ad id',
      'Option id',
      'User id',
    ]

    /* Quoted and doubled, always. An answer is free text somebody typed on a
       phone: it will contain commas, quotes and newlines eventually. */
    const cell = (v: string | number | boolean | null) =>
      v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`

    const lines = [
      header.join(','),
      ...visible.map((r) =>
        [
          cell(r.answeredAt),
          cell(r.adTitle),
          cell(r.adFormat),
          cell(r.questionPosition ?? ''),
          cell(r.questionText),
          cell(r.answer ?? ''),
          /* Blank, not FALSE, on an ungraded question. An opinion is neither
             right nor wrong and a column of FALSE would read as a wrong
             answer to every survey question ever asked. */
          cell(r.graded ? (r.correct ? 'yes' : 'no') : ''),
          cell(r.graded ? 'yes' : 'no'),
          cell(r.occasion),
          cell(r.attemptNumber),
          cell(r.watchSeconds ?? ''),
          cell(r.respondent),
          cell(r.phone ?? ''),
          cell(r.plan),
          cell(r.pointsAwarded ?? ''),
          cell(r.adId),
          cell(r.optionId ?? ''),
          cell(r.userId),
        ].join(','),
      ),
    ]

    /* \r\n and a BOM: Excel on Windows opens a plain UTF-8 CSV with the
       accents broken, and this operator's spreadsheets are on Windows. */
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const scope = data.adId
      ? (data.ads.find((x) => x.id === data.adId)?.title ?? 'ad').replace(/[^\w-]+/g, '-')
      : 'all-ads'
    a.download = `survey-responses-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const answerOf = (r: AdResponseRow) => r.answer ?? t('noAnswer')

  return (
    <>
      <Toolbar
        tabs={[
          { key: 'all', label: t('allAds'), count: data.rows.length },
          ...data.ads.map((a) => ({ key: a.id, label: a.title, count: a.responses })),
        ]}
        active={data.adId ?? 'all'}
        onSelect={(key) =>
          router.push(key === 'all' ? '/admin/ad-responses' : `/admin/ad-responses?ad=${key}`)
        }
        tabsLabel={t('tabsLabel')}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t('search')}
        actions={
          <button
            type="button"
            onClick={download}
            disabled={visible.length === 0}
            className={cn(
              'inline-flex items-center gap-2 rounded-(--radius-input) px-4 py-2.5',
              'text-[0.875rem] font-semibold transition-colors',
              visible.length > 0
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'cursor-not-allowed bg-ink-100 text-ink-400',
            )}
          >
            <Download aria-hidden className="size-4" />
            {t('download', { n: visible.length })}
          </button>
        }
      />

      {visible.length === 0 ? (
        <EmptyState>{data.rows.length === 0 ? t('empty') : t('noMatch')}</EmptyState>
      ) : (
        <>
          <TableShell>
            <thead>
              <tr>
                <th scope="col">{t('col.when')}</th>
                <th scope="col">{t('col.question')}</th>
                <th scope="col">{t('col.answer')}</th>
                <th scope="col">{t('col.who')}</th>
                <th scope="col" className="text-right">
                  {t('col.watched')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 200).map((r, i) => (
                <tr key={`${r.userId}-${r.adId}-${r.occasion}-${r.questionPosition}-${i}`}>
                  <td>
                    <span className="block text-[0.8125rem] text-ink-900">
                      {format.dateTime(new Date(r.answeredAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span className="block text-[0.75rem] text-ink-400">
                      {r.adTitle} · {t('occasion', { n: r.occasion })}
                    </span>
                  </td>
                  <td>
                    <span className="block max-w-[28ch] truncate text-[0.8125rem] text-ink-900">
                      {r.questionText}
                    </span>
                    <span className="block text-[0.75rem] text-ink-400">
                      {r.graded ? t('graded') : t('ungraded')}
                    </span>
                  </td>
                  <td>
                    <span className="block max-w-[24ch] truncate text-[0.8125rem] font-medium text-ink-900">
                      {answerOf(r)}
                    </span>
                    {r.graded && (
                      <span
                        className={cn(
                          'block text-[0.75rem]',
                          r.correct ? 'text-success-700' : 'text-danger-600',
                        )}
                      >
                        {r.correct ? t('correct') : t('incorrect')}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="block text-[0.8125rem] text-ink-900">{r.respondent}</span>
                    <span className="block font-mono text-[0.75rem] text-ink-400">
                      {r.phone ?? '—'} · {r.plan}
                    </span>
                  </td>
                  <td className="text-right tabular-nums text-[0.8125rem] text-ink-600">
                    {r.watchSeconds === null ? '—' : t('seconds', { n: r.watchSeconds })}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          {/* ⚠️ TableShell is desktop-only. Without this list the screen is
              blank on a phone, which has shipped before. */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {visible.slice(0, 200).map((r, i) => (
              <li
                key={`${r.userId}-${r.adId}-${r.occasion}-${r.questionPosition}-m${i}`}
                className="rounded-(--radius-card) border border-ink-200 bg-surface p-3.5"
              >
                <p className="text-[0.75rem] text-ink-400">
                  {format.dateTime(new Date(r.answeredAt), { dateStyle: 'medium', timeStyle: 'short' })}
                  {' · '}
                  {r.adTitle}
                </p>
                <p className="mt-1 text-[0.8125rem] text-ink-600">{r.questionText}</p>
                <p className="mt-1 text-[0.9375rem] font-semibold text-ink-900">{answerOf(r)}</p>
                <p className="mt-1.5 text-[0.75rem] text-ink-500">
                  {r.respondent} · <span className="font-mono">{r.phone ?? '—'}</span> · {r.plan}
                  {r.graded && (
                    <span className={r.correct ? ' text-success-700' : ' text-danger-600'}>
                      {' · '}
                      {r.correct ? t('correct') : t('incorrect')}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>

          {visible.length > 200 && (
            <p className="mt-3 text-[0.75rem] text-ink-500">
              {t('truncated', { shown: 200, total: visible.length })}
            </p>
          )}
        </>
      )}

      <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-400">{t('privacy')}</p>
    </>
  )
}
