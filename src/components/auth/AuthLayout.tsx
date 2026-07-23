import { PromoPanel } from '@/components/auth/PromoPanel'
import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/cn'

/**
 * Shell for every auth screen, rebuilt to the operator's second round of
 * references (2026-07-23): a white card floating on an ambient blue gradient,
 * form on the LEFT, light promo panel on the RIGHT — the arrangement both
 * desktop references share.
 *
 * Responsive behaviour, which the references imply but cannot show:
 *   mobile  (<768px)   No card, no panel — a clean white sheet with the form
 *                      centered under its icon chip, exactly like the phone
 *                      reference. The FormHeader chip carries the brand here.
 *   tablet  (768px+)   Card appears on the gradient; panel takes 44%.
 *   desktop (1280px+)  Full composition with the floating mockup.
 *
 * The panel is decorative and rendered after the form in the DOM, so
 * keyboard and screen-reader users hit the form first.
 */
export function AuthLayout({
  children,
  compact = false,
}: {
  children: React.ReactNode
  /** Narrower form column, for short screens like code entry. */
  compact?: boolean
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface md:items-center md:justify-center md:bg-auth-ambient md:p-6 lg:p-10">
      <div
        className={cn(
          'flex w-full flex-1 flex-col md:flex-none md:flex-row',
          'md:max-w-[68rem] md:min-h-[41rem] md:overflow-hidden md:rounded-(--radius-panel) md:bg-surface',
          'md:shadow-[0_1px_2px_rgb(15_23_42/0.05),0_32px_64px_-24px_rgb(0_36_92/0.35)]',
        )}
      >
        {/* -------------------------------------------------------------- */}
        {/* Form column                                                     */}
        {/* -------------------------------------------------------------- */}
        <div className="flex flex-1 flex-col">
          {/* The panel carries the brand from md up; on mobile it does not
              render, so the form column takes over. */}
          <div className="flex justify-center pt-9 md:hidden">
            <Logo variant="dark" />
          </div>

          <main className="flex flex-1 items-start justify-center px-5 pb-10 pt-8 sm:px-8 md:items-center md:px-10 md:py-12 xl:px-14">
            <div className={cn('w-full', compact ? 'max-w-[21rem]' : 'max-w-[23.5rem]')}>
              {children}
            </div>
          </main>
        </div>

        {/* -------------------------------------------------------------- */}
        {/* Promo panel — decorative, desktop/tablet only                   */}
        {/* -------------------------------------------------------------- */}
        <aside
          className={cn(
            'bg-promo-panel relative isolate hidden overflow-hidden',
            'md:m-2.5 md:ml-0 md:flex md:w-[44%] md:shrink-0 md:flex-col md:rounded-[1rem] md:p-7',
            'xl:w-[46%] xl:p-9',
          )}
        >
          <PromoPanel />
        </aside>
      </div>
    </div>
  )
}
