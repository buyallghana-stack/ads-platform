import { cn } from '@/lib/cn'

/**
 * A labelled value the user cannot edit.
 *
 * WHY THIS EXISTS RATHER THAN A DISABLED TextField. A disabled `<input>` was
 * being used to show somebody their own email address, and an input CLIPS a
 * value too long to fit — `emmanuel_ofori2929@icloud.com` on a 390px phone
 * was sliced mid-character at the border, with the rest unreachable because
 * a disabled input cannot be scrolled or selected. The operator reported it
 * as the text overlapping the field, which is exactly what it looks like.
 *
 * An input is a control for entering something. When there is nothing to
 * enter, the right element is text — and text wraps. `break-all` rather than
 * `break-words` because an email address is one unbroken token: `break-words`
 * would leave it clipped just the same.
 *
 * Keeping the same label styling, height and border as TextField means the
 * two sit together in a form without looking like different species.
 */
export function ReadOnlyField({
  label,
  value,
  hint,
  leadingIcon,
  className,
}: {
  label: string
  value: string
  hint?: string
  /** Muted icon inside the left edge, matching TextField. */
  leadingIcon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[0.8125rem] font-medium text-ink-700">{label}</span>

      <div
        className={cn(
          'relative flex min-h-10 w-full items-center rounded-(--radius-input)',
          'border border-ink-200 bg-ink-50 py-2 pr-3.5',
          leadingIcon ? 'pl-10' : 'pl-3.5',
          'pointer-coarse:min-h-11',
        )}
      >
        {leadingIcon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 [&>svg]:size-4"
          >
            {leadingIcon}
          </span>
        )}
        {/* Selectable on purpose: somebody checking which address they signed
            up with should be able to copy it. */}
        <span className="min-w-0 break-all text-sm leading-snug text-ink-500 pointer-coarse:text-base">
          {value}
        </span>
      </div>

      {hint && <p className="text-[0.75rem] leading-snug text-ink-400">{hint}</p>}
    </div>
  )
}
