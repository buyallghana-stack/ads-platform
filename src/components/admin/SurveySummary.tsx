'use client'

import { useMemo, useState } from 'react'

import { ImageDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { AdResponseRow } from '@/lib/admin/responses-data'

/**
 * The survey, summarised — on screen and as a downloadable picture.
 *
 * Operator, 2026-08-12: *"add downloadable charts that summarizes the whole csv
 * too so it becomes easy and fast to analyze."* The CSV answers "what did each
 * person say"; this answers "what did they say, overall", which is the question
 * somebody actually opens a survey report to ask.
 *
 * ── WHY BARS, AND WHY ONE COLOUR ──
 *
 * The reader's job on a survey question is to compare magnitude: which option
 * won and by how much. That is a bar chart with a SEQUENTIAL encoding — one
 * hue, more-is-darker — not a categorical palette. Options are one measure
 * being compared, not series to tell apart, and giving each its own colour
 * would spend the identity channel on nothing and bury the winner.
 *
 * One series therefore needs no legend: the question above the bars says what
 * is plotted. Every bar is directly labelled with its count and share, which is
 * the exception the rule allows — with fewer than ten bars and no axis, the
 * labels ARE the scale.
 *
 * Horizontal rather than vertical because option text is long ("None of these"),
 * and a rotated label is a label nobody reads.
 *
 * ── ONE SVG, TWO DESTINATIONS ──
 *
 * The same string is rendered on screen and rasterised for the download, so the
 * picture in the file is the picture that was checked. It is deliberately a
 * single light-mode look: this is a document that gets emailed to an
 * advertiser, and a chart that changed colour with the reader's OS would be a
 * different artefact each time it was opened.
 *
 * Colours are the validated sequential blue (`#2a78d6`, light end `#86b6ef`):
 * monotone lightness, one hue, light end clear of the surface at 2.06:1.
 */

/* ── palette, literal on purpose ────────────────────────────────────────────
   A CSS variable cannot survive the trip through canvas, so the marks carry
   real hex. These are the sequential blue's steps 450 and 250. */
const INK = '#0b0b0b'
const MUTED = '#52514e'
const SURFACE = '#ffffff'
const HAIRLINE = '#e6e6e3'
const BAR = '#2a78d6'
const BAR_LIGHT = '#86b6ef'

type Aggregate = {
  key: string
  position: number
  text: string
  graded: boolean
  format: string
  answers: number
  options: { label: string; count: number; share: number }[]
  /** Free-text questions have no options to chart; a few examples read better. */
  samples: string[]
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Cut to fit, because an SVG has no ellipsis of its own. */
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`)

export function SurveySummary({ rows, scope }: { rows: AdResponseRow[]; scope: string }) {
  const t = useTranslations('admin.responses.summary')
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => {
    const byQuestion = new Map<string, Aggregate>()
    const people = new Set<string>()
    let earliest = ''
    let latest = ''

    for (const r of rows) {
      people.add(r.userId)
      if (!earliest || r.answeredAt < earliest) earliest = r.answeredAt
      if (!latest || r.answeredAt > latest) latest = r.answeredAt

      /* Keyed by the WORDING, not the question id: the wording is snapshot per
         answer, so a question edited half way through a campaign genuinely has
         two sets of answers and merging them would report a total nobody was
         ever asked. */
      const key = `${r.questionPosition ?? 0}::${r.questionText}`
      let q = byQuestion.get(key)
      if (!q) {
        q = {
          key,
          position: r.questionPosition ?? 0,
          text: r.questionText,
          graded: r.graded,
          format: r.answerFormat,
          answers: 0,
          options: [],
          samples: [],
        }
        byQuestion.set(key, q)
      }

      q.answers += 1
      const label = (r.answer ?? '').trim()
      if (!label) continue

      if (r.answerFormat === 'multiple_choice') {
        const seen = q.options.find((o) => o.label === label)
        if (seen) seen.count += 1
        else q.options.push({ label, count: 1, share: 0 })
      } else if (q.samples.length < 3) {
        q.samples.push(label)
      }
    }

    const questions = [...byQuestion.values()].sort((a, b) => a.position - b.position)
    for (const q of questions) {
      q.options.sort((a, b) => b.count - a.count)
      for (const o of q.options) o.share = q.answers > 0 ? o.count / q.answers : 0
    }

    return { questions, people: people.size, answers: rows.length, earliest, latest }
  }, [rows])

  const svg = useMemo(() => buildSvg(summary, scope, t), [summary, scope, t])

  const downloadPng = () => {
    setBusy(true)
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      /* 2x, because this is read on a laptop and often pasted into a slide. */
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = image.width * scale
      canvas.height = image.height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setBusy(false)
        return
      }
      ctx.scale(scale, scale)
      ctx.drawImage(image, 0, 0)
      URL.revokeObjectURL(url)

      canvas.toBlob((png) => {
        if (png) {
          const link = document.createElement('a')
          link.href = URL.createObjectURL(png)
          link.download = `survey-summary-${scope.replace(/[^\w-]+/g, '-')}-${new Date()
            .toISOString()
            .slice(0, 10)}.png`
          link.click()
          URL.revokeObjectURL(link.href)
        }
        setBusy(false)
      }, 'image/png')
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      setBusy(false)
    }
    image.src = url
  }

  if (summary.answers === 0) return null

  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">
          {t('title')}
        </h2>
        <button
          type="button"
          onClick={downloadPng}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-ink-200 px-3 py-1.5 text-[0.75rem] font-semibold text-ink-700 transition-colors hover:border-brand-600 hover:text-brand-700 disabled:opacity-60"
        >
          <ImageDown aria-hidden className="size-3.5" />
          {busy ? t('preparing') : t('download')}
        </button>
      </div>

      {/* The same SVG the download rasterises. Generated here from our own
          data with every label escaped, never from anything a browser sent. */}
      <div
        className="mt-3 overflow-x-auto rounded-(--radius-card) border border-ink-200 bg-white"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </section>
  )
}

/* ---------------------------------------------------------------------------
   The picture
   --------------------------------------------------------------------------- */

function buildSvg(
  summary: {
    questions: Aggregate[]
    people: number
    answers: number
    earliest: string
    latest: string
  },
  scope: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const W = 760
  const PAD = 28
  const LABEL_W = 200
  const BAR_MAX = W - PAD * 2 - LABEL_W - 92 // room for the value label
  const ROW = 30 // 22px bar + 8px air, so bars never fill their slot
  const parts: string[] = []

  let y = PAD

  // ── heading ──────────────────────────────────────────────────────────────
  parts.push(
    `<text x="${PAD}" y="${y + 16}" font-size="17" font-weight="700" fill="${INK}">${escape(
      clip(scope, 58),
    )}</text>`,
  )
  y += 26
  const span =
    summary.earliest && summary.latest
      ? `${summary.earliest.slice(0, 10)} → ${summary.latest.slice(0, 10)}`
      : ''
  parts.push(
    `<text x="${PAD}" y="${y + 12}" font-size="12" fill="${MUTED}">${escape(
      t('caption', { answers: summary.answers, people: summary.people, span }),
    )}</text>`,
  )
  y += 30

  // ── the KPI row: headline numbers are not a chart ────────────────────────
  const tiles: [string, string][] = [
    [String(summary.answers), t('tiles.answers')],
    [String(summary.people), t('tiles.people')],
    [String(summary.questions.length), t('tiles.questions')],
  ]
  const tileW = (W - PAD * 2 - 16) / 3
  tiles.forEach(([value, label], i) => {
    const x = PAD + i * (tileW + 8)
    parts.push(
      `<rect x="${x}" y="${y}" width="${tileW}" height="58" rx="10" fill="#f7f9fc" />` +
        `<text x="${x + 14}" y="${y + 27}" font-size="20" font-weight="700" fill="${INK}">${escape(
          value,
        )}</text>` +
        `<text x="${x + 14}" y="${y + 45}" font-size="11" fill="${MUTED}">${escape(label)}</text>`,
    )
  })
  y += 78

  // ── one block per question ───────────────────────────────────────────────
  for (const q of summary.questions) {
    parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${HAIRLINE}" />`)
    y += 22

    /* ⚠️ NO NUMBER PREFIX. `question_position` comes from the branching engine,
       where two questions can share a position and a survey can start at 0 —
       the operator's own survey reads 0, 1, 1, 2, 2, 3, 5, 6, 7, which looks
       like a bug in the report rather than a fact about the survey. The
       wording identifies the question; the CSV carries the raw position for
       anybody who needs to line the two up. */
    parts.push(
      `<text x="${PAD}" y="${y}" font-size="13" font-weight="600" fill="${INK}">${escape(
        clip(q.text, 92),
      )}</text>`,
    )
    y += 16
    parts.push(
      `<text x="${PAD}" y="${y}" font-size="11" fill="${MUTED}">${escape(
        t(q.graded ? 'gradedNote' : 'opinionNote', { n: q.answers }),
      )}</text>`,
    )
    y += 16

    if (q.options.length > 0) {
      const top = q.options[0]!.count || 1
      for (const option of q.options) {
        const width = Math.max((option.count / top) * BAR_MAX, 2)
        const cy = y + 4

        parts.push(
          `<text x="${PAD}" y="${cy + 15}" font-size="12" fill="${MUTED}">${escape(
            clip(option.label, 26),
          )}</text>`,
        )
        /* 4px rounded data-end, square at the baseline: two rects, the second
           covering the left corners, which is cheaper than a path and reads
           identically at this size. */
        parts.push(
          `<rect x="${PAD + LABEL_W}" y="${cy}" width="${width}" height="22" rx="4" fill="${
            option.count === top ? BAR : BAR_LIGHT
          }" />` +
            `<rect x="${PAD + LABEL_W}" y="${cy}" width="${Math.min(4, width)}" height="22" fill="${
              option.count === top ? BAR : BAR_LIGHT
            }" />`,
        )
        parts.push(
          `<text x="${PAD + LABEL_W + width + 10}" y="${cy + 15}" font-size="12" font-weight="600" fill="${INK}">${escape(
            `${option.count}  ${Math.round(option.share * 100)}%`,
          )}</text>`,
        )
        y += ROW
      }
    } else if (q.samples.length > 0) {
      /* Free text does not become a bar chart. Three real answers say more
         about a written question than any count of them could. */
      for (const sample of q.samples) {
        parts.push(
          `<text x="${PAD}" y="${y + 14}" font-size="12" fill="${MUTED}">${escape(
            `“${clip(sample, 88)}”`,
          )}</text>`,
        )
        y += 20
      }
      parts.push(
        `<text x="${PAD}" y="${y + 14}" font-size="11" fill="${MUTED}">${escape(
          t('written', { n: q.answers }),
        )}</text>`,
      )
      y += 22
    }

    y += 12
  }

  const H = y + PAD - 12

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`,
    ` font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" role="img">`,
    `<rect width="${W}" height="${H}" fill="${SURFACE}" />`,
    parts.join(''),
    `</svg>`,
  ].join('')
}
