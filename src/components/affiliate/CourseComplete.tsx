'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { Award, Download, PartyPopper, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'

/*
  The confetti, decided once at module load rather than per render.

  ⚠️ NOT `Math.random()`. Scattering with it puts an impure call in the render
  path, which React's own lint rule rejects for a good reason: a component that
  produces different output from the same props cannot be re-rendered safely,
  and under SSR it is also the classic hydration mismatch. A hash of the piece's
  index gives the same scatter every time from nothing but the index, which
  looks exactly as random and is a pure function of it.
*/
const CONFETTI = Array.from({ length: 42 }, (_, i) => {
  /* The standard GLSL one-liner: sin, scale, keep the fractional part. */
  const noise = (salt: number) => {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  return {
    id: i,
    left: noise(1) * 100,
    drift: Math.round((noise(2) - 0.5) * 160),
    spin: Math.round(360 + noise(3) * 720),
    delay: noise(4) * 2.2,
    duration: 2.6 + noise(5) * 2.2,
    size: 6 + Math.round(noise(6) * 6),
    colour: ['#7c3aed', '#c026d3', '#f59e0b', '#10b981', '#0ea5e9'][i % 5],
  }
})

/**
 * Finishing a course: the moment, and the panel it leaves behind.
 *
 * Operator, 2026-08-08: "when a user successfully complete a course show him a
 * congratulation screen and a button for him to download his certificate".
 *
 * ── TWO THINGS, NOT ONE ──
 *
 * A celebration that only ever appears once is a celebration somebody can miss
 * by having a page open when the last lesson lands, or by tapping the backdrop
 * a second too early. And a panel that never celebrates is not the moment that
 * was asked for. So this is both:
 *
 *   1. THE SCREEN. A full-viewport congratulation, shown once per course.
 *   2. THE PANEL. Always on the course page from then on, carrying the same
 *      certificate button, so the route to the document never disappears.
 *
 * ── ONCE PER COURSE, AND WHY IT IS LOCAL ──
 *
 * `localStorage`, keyed by course. There is nothing worth a database column
 * here: the cost of the state being wrong is seeing a congratulation twice, or
 * on a second device once, and the cost of a column is a migration plus a
 * write on a page read. It is also deliberately not `sessionStorage`, which
 * would fire again every time the tab is reopened.
 *
 * ── WHY THE CERTIFICATE IS PASSED IN RATHER THAN ASSUMED ──
 *
 * Completing a course does not always produce one. A programme can have
 * certificates switched off, and a course whose checkpoints were scored below
 * the pass mark issues none by design. Congratulating somebody and then
 * handing them a button to a page that 404s is worse than not congratulating
 * them, so the button only exists when the row does.
 */
export function CourseComplete({
  productId,
  title,
  lessons,
  grade,
  hasCertificate,
}: {
  productId: string
  title: string
  lessons: number
  /** The graded score, when the course had checkpoints to score. */
  grade: number | null
  /** Whether a certificate row actually exists for this person and course. */
  hasCertificate: boolean
}) {
  const t = useTranslations('affiliate.complete')
  const [dismissed, setDismissed] = useState(false)

  const storageKey = `sp:course-celebrated:${productId}`

  /*
    ⚠️ READ THROUGH `useSyncExternalStore`, NOT IN AN EFFECT THAT SETS STATE.

    `localStorage` is state living outside React, and the two obvious ways to
    read it are both wrong here. A `useState` initialiser touches `window`,
    which does not exist while this renders on the server. An effect that calls
    `setOpen` renders the page once without the overlay and again with it,
    which is the cascading render React's lint rule objects to and, worse,
    shows the course page for a frame before the celebration lands on top.

    This is what the hook is for: the server snapshot says "already seen", so
    nothing renders during SSR, and the client's first paint reads the real
    answer. There is no subscription because the value cannot change under us
    — nothing else in the app writes this key.
  */
  const seen = useSyncExternalStore(
    () => () => {},
    () => {
      /* Safari in private mode THROWS on `localStorage` rather than returning
         null. A celebration is not worth taking the page down for, and the
         safe direction to fail is "not yet seen": showing it again is a much
         smaller wrong than never showing it. */
      try {
        return window.localStorage.getItem(storageKey) !== null
      } catch {
        return false
      }
    },
    () => true,
  )

  const open = !seen && !dismissed

  useEffect(() => {
    if (seen) return
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      /* See above. It will simply celebrate again next visit. */
    }
  }, [seen, storageKey])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissed(true)
    }
    document.addEventListener('keydown', onKey)
    /* The page behind must not scroll under the overlay on a phone. */
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <>
      <CompletePanel
        t={t}
        productId={productId}
        grade={grade}
        hasCertificate={hasCertificate}
      />
      {open && (
        <CongratulationScreen
          t={t}
          productId={productId}
          title={title}
          lessons={lessons}
          grade={grade}
          hasCertificate={hasCertificate}
          onClose={() => setDismissed(true)}
        />
      )}
    </>
  )
}

/* ── the line that stays on the course page ─────────────────────────────── */

function CompletePanel({
  t,
  productId,
  grade,
  hasCertificate,
}: {
  t: ReturnType<typeof useTranslations>
  productId: string
  grade: number | null
  hasCertificate: boolean
}) {
  return (
    <section className="mt-3 flex flex-col gap-3 rounded-(--radius-panel) border border-success-500/30 bg-success-50 p-3.5 sm:flex-row sm:items-center sm:gap-4">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-success-500/20 text-success-600"
      >
        <Award className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold text-ink-900">{t('panelTitle')}</p>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-600">
          {grade === null ? t('panelBody') : t('panelBodyGraded', { grade })}
        </p>
      </div>
      {hasCertificate && (
        <Link
          href={`/market/certificate/${productId}`}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-(--radius-control) bg-success-600 px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-success-700"
        >
          <Download aria-hidden className="size-4" />
          {t('download')}
        </Link>
      )}
    </section>
  )
}

/* ── the moment ─────────────────────────────────────────────────────────── */

function CongratulationScreen({
  t,
  productId,
  title,
  lessons,
  grade,
  hasCertificate,
  onClose,
}: {
  t: ReturnType<typeof useTranslations>
  productId: string
  title: string
  lessons: number
  grade: number | null
  hasCertificate: boolean
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-complete-title"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Decorative only, and behind the card. Announcing forty-two divs to a
          screen reader would bury the one sentence that matters. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {CONFETTI.map((piece) => (
          <span
            key={piece.id}
            className="absolute top-0 block rounded-[1px]"
            style={
              {
                left: `${piece.left}%`,
                width: piece.size,
                height: piece.size * 1.6,
                background: piece.colour,
                opacity: 0,
                '--drift': `${piece.drift}px`,
                '--spin': `${piece.spin}deg`,
                animation: `confetti-fall ${piece.duration}s linear ${piece.delay}s 2 both`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-(--radius-panel) bg-surface shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          <X aria-hidden className="size-4" />
        </button>

        {/* The band is a literal gradient rather than tokens: it is the same
            violet-to-magenta the certificate's own spine uses, so the moment
            and the document it leads to look like one thing. */}
        <div
          className="flex flex-col items-center px-6 pb-7 pt-9 text-center"
          style={{ background: 'linear-gradient(150deg, #7c3aed, #c026d3)' }}
        >
          <span
            aria-hidden
            className="grid size-16 place-items-center rounded-full bg-white/20 text-white ring-4 ring-white/25"
            style={{ animation: 'medal-pop 0.6s cubic-bezier(0.22, 1, 0.36, 1) both' }}
          >
            <Award className="size-9" strokeWidth={2} />
          </span>
          <p className="mt-4 flex items-center gap-1.5 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-white/80">
            <PartyPopper aria-hidden className="size-3.5" />
            {t('eyebrow')}
          </p>
          <h2
            id="course-complete-title"
            className="mt-1 text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-white"
          >
            {t('title')}
          </h2>
          <p className="mt-1.5 text-[0.875rem] leading-snug text-white/85">
            {t('subtitle', { course: title })}
          </p>
        </div>

        <div className="px-6 py-5">
          <dl className="flex items-stretch gap-3">
            <Stat label={t('statLessons')} value={String(lessons)} />
            {grade !== null && <Stat label={t('statGrade')} value={`${grade}%`} />}
          </dl>

          <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-600">
            {hasCertificate ? t('bodyCertificate') : t('bodyNoCertificate')}
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {hasCertificate && (
              <Link
                href={`/market/certificate/${productId}`}
                className="flex h-11 items-center justify-center gap-2 rounded-(--radius-control) bg-brand-600 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-700"
              >
                <Download aria-hidden className="size-4" />
                {t('download')}
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 items-center justify-center rounded-(--radius-control) border border-ink-200 text-[0.875rem] font-semibold text-ink-700 transition-colors hover:bg-ink-100"
            >
              {t('back')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-(--radius-card) border border-ink-200 bg-field px-3 py-2.5 text-center">
      <dt className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-ink-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-[1.125rem] font-bold tabular-nums text-ink-900">{value}</dd>
    </div>
  )
}
