import { Wrench } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Logo } from '@/components/brand/Logo'
import { LogOutButton } from '@/components/app/LogOutButton'

/**
 * What a member sees while the app is closed.
 *
 * It replaces the whole shell rather than sitting over it: there is no
 * navigation, because every destination is shut, and a tab bar under a notice
 * saying the app is unavailable is an invitation to keep tapping.
 *
 * ⚠️ IT KEEPS THE SIGN-OUT. Somebody locked out of an app with no way to leave
 * their own session is a support message, and the operator is the one who has
 * to answer it.
 *
 * It says nothing about what is being worked on and promises no time. A
 * maintenance screen that guesses "back in an hour" is a promise nobody
 * checked, and the one thing worse than a closed app is a closed app that lied
 * about when it would open.
 */
export async function MaintenanceScreen() {
  const t = await getTranslations('maintenance')

  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <Logo className="h-7 w-auto text-ink-900" />

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span
          aria-hidden
          className="grid size-16 place-items-center rounded-full bg-brand-50 text-brand-700"
        >
          <Wrench className="size-7" />
        </span>

        <h1 className="mt-6 text-[1.5rem] font-bold tracking-[-0.02em] text-ink-900">
          {t('title')}
        </h1>
        <p className="mt-2.5 max-w-[24rem] text-[0.9375rem] leading-relaxed text-ink-600">
          {t('body')}
        </p>
        <p className="mt-4 max-w-[24rem] text-[0.8125rem] leading-relaxed text-ink-500">
          {t('balance')}
        </p>
      </div>

      <div className="flex justify-center">
        <LogOutButton />
      </div>
    </div>
  )
}
