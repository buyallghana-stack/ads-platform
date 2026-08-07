import { getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { SupportChatButton } from '@/components/support/SupportChatButton'
import { ModeSwitchButton } from '@/components/app/ModeSwitch'
import type { getNotifications } from '@/lib/notifications/data'

/**
 * The header every affiliate screen starts with.
 *
 * Carries the same chrome the ads Home header does — bell, support — grouped
 * in one bordered pill for the same reason: three loose glyphs on a gradient
 * wash read as decoration rather than as controls.
 *
 * What it adds is the MODE SWITCH, and it is the reason this header appears on
 * every affiliate screen rather than only on the dashboard. In the ads business
 * the header is Home-only (operator direction 2026-07-24) because there is
 * nowhere else to go from a sub-screen. Here there is: somebody four screens
 * into the marketplace still needs one tap back to the business that holds
 * their points, and putting that behind "go to the dashboard first" is the kind
 * of small tax that makes a second business feel like a basement.
 *
 * No theme switch. This mode is dark by definition — the skin is not the user's
 * preference and a control that appears to change it would be lying.
 */
export async function AffiliateHeader({
  notifications,
  unreadCount,
  now,
}: {
  notifications: Awaited<ReturnType<typeof getNotifications>>
  unreadCount: number
  now: number
}) {
  const t = await getTranslations('affiliate.nav')

  return (
    /* ⚠️ NOTHING IN THIS ROW COULD SHRINK, so at 360px it ran 3px off the
       screen and at 320px it ran 43px off, on every affiliate screen. The
       wordmark is what gives: the mark alone still says whose app this is,
       and the mode switch beside it is the one control that must stay legible
       because it is the only door back to the earning side. */
    <header className="flex min-w-0 items-center gap-2 sm:gap-3">
      <Logo variant="dark" className="min-w-0 md:hidden" wordmarkClassName="hidden min-[380px]:inline" />
      <span className="sr-only">{t('modeName')}</span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ModeSwitchButton to="earn" />
        <div className="flex items-center rounded-full border border-ink-200 bg-surface p-0.5">
          <NotificationBell notifications={notifications} unreadCount={unreadCount} now={now} />
          <SupportChatButton />
        </div>
      </div>
    </header>
  )
}
