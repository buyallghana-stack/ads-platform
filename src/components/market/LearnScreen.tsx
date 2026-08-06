import Image from 'next/image'
import { Award, ChevronRight, GraduationCap } from 'lucide-react'

import { Link } from '@/i18n/navigation'
import { coverUrl } from '@/lib/market/covers'
import { cn } from '@/lib/cn'
import type { EarnedCertificate, OngoingCourse } from '@/lib/market/data'

/**
 * The Learn tab, built to reference 0572 screen 3.
 *
 * Two lists, and the split is the point:
 *
 *   Certifications   what you finished — a horizontal carousel of trophies
 *   Ongoing          what you are in the middle of — a vertical worklist
 *
 * A finished course does NOT appear in "ongoing". It has a certificate, which
 * is the better thing to show it as, and a completed row with a full bar in a
 * list of unfinished work is a row you have to read to discover there is
 * nothing to do.
 *
 * The reference leads with the certifications even though they are the smaller
 * list, and that is right: opening a learning screen to be shown what you have
 * achieved is a better first second than opening it to a list of homework.
 */
export function LearnScreen({
  certificates,
  ongoing,
  labels,
}: {
  certificates: EarnedCertificate[]
  ongoing: OngoingCourse[]
  labels: {
    title: string
    certifications: string
    viewAll: string
    ongoing: string
    continueLabel: string
    lessonsLeft: (n: number) => string
    completed: (date: string) => string
    emptyTitle: string
    emptyBody: string
    emptyCta: string
  }
}) {
  if (certificates.length === 0 && ongoing.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:px-8">
        <div className="rounded-(--radius-panel) border border-dashed border-ink-300 bg-surface px-4 py-14 text-center">
          <GraduationCap aria-hidden className="mx-auto size-7 text-ink-400" strokeWidth={1.5} />
          <p className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{labels.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-sm text-[0.875rem] leading-snug text-ink-600">
            {labels.emptyBody}
          </p>
          <Link
            href="/shop"
            className="mt-5 inline-flex rounded-full bg-action px-5 py-3 text-[0.9375rem] font-semibold text-on-action transition-opacity hover:opacity-90"
          >
            {labels.emptyCta}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-6 pt-5">
      {certificates.length > 0 && (
        <section>
          <Head title={labels.certifications} action={labels.viewAll} />
          <div className="mx-auto w-full max-w-6xl">
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:px-6 md:px-8 [&::-webkit-scrollbar]:hidden">
              {certificates.map((c, i) => (
                <CertificateCard key={c.id} certificate={c} index={i} labels={labels} />
              ))}
            </div>
          </div>
        </section>
      )}

      {ongoing.length > 0 && (
        <section className={cn(certificates.length > 0 && 'mt-7')}>
          <Head title={labels.ongoing} />
          <div className="mx-auto w-full max-w-6xl space-y-2.5 px-4 sm:px-6 md:px-8 lg:grid lg:grid-cols-2 lg:gap-2.5 lg:space-y-0">
            {ongoing.map((course) => (
              <OngoingRow key={course.productId} course={course} labels={labels} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Head({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mx-auto mb-3 flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 md:px-8">
      <h2 className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-ink-900">{title}</h2>
      {action && (
        <span className="inline-flex items-center gap-0.5 text-[0.8125rem] font-semibold text-jade-700">
          {action}
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      )}
    </div>
  )
}

/* The reference tints each certificate card a different soft colour rather than
   showing cover art — a trophy shelf, not a catalogue. Cycled by position so a
   row of them looks deliberate instead of random. */
const TINTS = [
  'bg-violet-50 border-violet-500/20',
  'bg-orange-50 border-orange-500/20',
  'bg-teal-50 border-teal-500/20',
  'bg-jade-50 border-jade-600/20',
]

function CertificateCard({
  certificate,
  index,
  labels,
}: {
  certificate: EarnedCertificate
  index: number
  labels: { completed: (date: string) => string }
}) {
  const issued = new Date(certificate.issuedAt).toLocaleDateString('en-GH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <Link
      href={`/learn/${certificate.slug}`}
      className={cn(
        'flex w-[16.5rem] shrink-0 snap-start flex-col rounded-(--radius-card) border p-4 sm:w-[19rem]',
        TINTS[index % TINTS.length],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface/80 text-ink-700"
        >
          <Award className="size-5" strokeWidth={1.75} />
        </span>
        {certificate.grade !== null && (
          <span className="text-right">
            <span className="block text-[0.6875rem] text-ink-500">Grade</span>
            <span className="block text-[1.125rem] font-semibold tabular-nums text-ink-900">
              {certificate.grade}%
            </span>
          </span>
        )}
      </div>

      <p className="mt-3 line-clamp-2 text-[0.9375rem] leading-snug font-semibold text-ink-900">
        {certificate.title}
      </p>
      <p className="mt-1 text-[0.75rem] text-ink-600">{labels.completed(issued)}</p>

      {certificate.instructor && (
        <p className="mt-auto pt-3 text-[0.75rem] text-ink-600">{certificate.instructor}</p>
      )}
    </Link>
  )
}

function OngoingRow({
  course,
  labels,
}: {
  course: OngoingCourse
  labels: { continueLabel: string; lessonsLeft: (n: number) => string }
}) {
  const cover = coverUrl(course.coverPath)

  return (
    <Link
      href={`/learn/${course.slug}`}
      className="flex gap-3 rounded-(--radius-card) border border-ink-200 bg-surface p-3 transition-colors hover:border-ink-300"
    >
      <span className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-xl bg-ink-100">
        {cover ? (
          <Image src={cover} alt="" fill sizes="72px" className="object-cover" />
        ) : (
          <span className="grid size-full place-items-center">
            <GraduationCap aria-hidden className="size-5 text-ink-400" strokeWidth={1.5} />
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start justify-between gap-2">
          {course.category ? (
            <span className="rounded-md bg-jade-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-jade-700">
              {course.category}
            </span>
          ) : (
            <span />
          )}
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.75rem] font-semibold text-jade-700">
            {labels.continueLabel}
            <ChevronRight aria-hidden className="size-3.5" />
          </span>
        </span>

        <span className="mt-1 block truncate text-[0.9375rem] font-semibold text-ink-900">
          {course.title}
        </span>
        {course.description && (
          <span className="mt-0.5 block truncate text-[0.75rem] text-ink-600">
            {course.description}
          </span>
        )}

        <span className="mt-auto pt-2">
          <span className="flex items-center justify-between text-[0.6875rem] text-ink-500">
            <span>{labels.lessonsLeft(course.lessonsLeft)}</span>
            <span className="tabular-nums">{course.percent}%</span>
          </span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink-100">
            <span
              className="block h-full rounded-full bg-jade-600"
              style={{ width: `${Math.min(100, course.percent)}%` }}
            />
          </span>
        </span>
      </span>
    </Link>
  )
}
