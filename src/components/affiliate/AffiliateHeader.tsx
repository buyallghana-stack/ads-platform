import { getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { SupportChatButton } from '@/components/support/SupportChatButton'
import { ThemeSwitchButton } from '@/components/theme/ThemeSwitchButton'
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
 * ── THE THEME SWITCH (operator, 2026-08-07) ──
 *
 * This header used to argue against having one: the mode was dark by
 * definition, so a control that appeared to change it would be lying. The
 * operator's ruling is that the affiliate side gets the same switch the ads
 * Home header has, in the same place beside the bell, and the skin answers to
 * it — so `globals.css` now carries a full light violet token set and the
 * control is telling the truth.
 *
 * It is the SAME component as the ads side, not a copy. One switch means one
 * setting: somebody who picked light on the ads Home does not arrive here to
 * find a second preference they never set.
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
       because it is the only door back to the earning side.
       ⚠️ THE BREAKPOINT MOVED WITH THE THEME SWITCH. A third 36px icon in the
       pill is 36px the wordmark no longer has, and at 390px it was clipped
       mid-word to "SidePer". Adding a control to this row means re-measuring
       this number, not just adding the control. */
    <header className="flex min-w-0 items-center gap-2 sm:gap-3">
      <Logo variant="dark" className="min-w-0 md:hidden" wordmarkClassName="hidden min-[430px]:inline" />
      <span className="sr-only">{t('modeName')}</span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ModeSwitchButton to="earn" />
        <div className="flex items-center rounded-full border border-ink-200 bg-surface p-0.5">
          <NotificationBell notifications={notifications} unreadCount={unreadCount} now={now} />
          <ThemeSwitchButton />
          <SupportChatButton />
        </div>
      </div>
    </header>
  )
}
