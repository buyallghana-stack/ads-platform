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
    /*
      ⚠️ THE MODE SWITCH GETS ITS OWN ROW ON A PHONE, and measuring is the only
      way to see why. Three things wanted this row — the wordmark, a door
      labelled "Watch & earn", and a three-icon pill — and at 390px they need
      about 33px more than there is. Every previous attempt paid for it out of
      the wordmark: first `min-[380px]`, then `min-[430px]`, and the operator's
      report was the result ("the SidePerks logo text is missing").

      Measured with `document.documentElement.scrollWidth` at 320/360/390/430,
      not by eye: the affiliate wordmark was being clipped at every width below
      430, and the ADS header was running 61px off the screen at 320px.

      So below `sm` the door drops to a line of its own, which is also the most
      prominent place it has ever been — the operator asked for it to pop. From
      `sm` there is room and it returns to the row.
    */
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
      <header className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Logo variant="dark" className="min-w-0 md:hidden" wordmarkClassName="inline" />
        <span className="sr-only">{t('modeName')}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Inline from sm, where the row can hold it. */}
          <ModeSwitchButton to="earn" className="hidden sm:inline-flex" />
          <div className="flex items-center rounded-full border border-ink-200 bg-surface p-0.5">
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              now={now}
              fullHref="/market/notifications"
            />
            <ThemeSwitchButton />
            <SupportChatButton />
          </div>
        </div>
      </header>

      {/* The phone copy. Only one of the two is ever displayed, so the
          accessibility tree only ever has one door in it. */}
      <ModeSwitchButton to="earn" className="w-fit sm:hidden" />
    </div>
  )
}
