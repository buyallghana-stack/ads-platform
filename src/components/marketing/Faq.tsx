import { ChevronDown } from 'lucide-react'

/**
 * FAQ accordion built on native <details>/<summary>.
 *
 * No state, no effects, no client bundle. On the cheap Android handsets this
 * platform is built for, the accordion that costs zero JavaScript and works
 * before hydration is strictly better than one that needs React to open — and
 * it comes with correct keyboard and screen-reader behaviour for free.
 *
 * Each item is independently open, deliberately: a visitor comparing "when can
 * I withdraw" against "what is a point worth" should not have the first answer
 * close as they open the second.
 */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-ink-200 overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary
            className="flex cursor-pointer list-none items-start gap-4 px-5 py-5 text-left transition-colors hover:bg-ink-50 sm:px-6 [&::-webkit-details-marker]:hidden"
          >
            <span className="flex-1 text-[0.9375rem] font-semibold text-pretty text-ink-900 sm:text-base">
              {item.q}
            </span>
            <ChevronDown
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5 sm:px-6">
            {/* Indented to the summary's text column so the answer reads as
                belonging to the question, not as a new block. */}
            <p className="max-w-3xl text-[0.9375rem] leading-relaxed text-pretty text-ink-600">
              {item.a}
            </p>
          </div>
        </details>
      ))}
    </div>
  )
}
