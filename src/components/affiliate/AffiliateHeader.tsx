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
    <header className="flex items-center gap-3">
      <Logo variant="dark" className="md:hidden" />
      <span className="sr-only">{t('modeName')}</span>

      <div className="ml-auto flex items-center gap-2">
        <ModeSwitchButton to="earn" />
        <div className="flex items-center rounded-full border border-ink-200 bg-surface p-0.5">
          <NotificationBell notifications={notifications} unreadCount={unreadCount} now={now} />
          <SupportChatButton />
        </div>
      </div>
    </header>
  )
}
