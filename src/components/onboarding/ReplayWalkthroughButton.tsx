'use client'

import { useTransition } from 'react'

import { RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { useRouter } from '@/i18n/navigation'
import { replayOnboarding } from '@/lib/onboarding/actions'

/**
 * Run the walkthrough again.
 *
 * Useful to a member who skipped it and changed their mind, and useful to the
 * operator demonstrating the app. It clears only the steps that were SHOWN:
 * a payout account that exists stays ticked, so the replay walks past it
 * rather than implying it was undone.
 */
export function ReplayWalkthroughButton() {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await replayOnboarding()
          /* Home is where the first step lives, and pushing there means the
             walkthrough opens on the screen it is about rather than on the
             settings list they pressed it from. */
          router.push('/dashboard')
          router.refresh()
        })
      }
      className="inline-flex items-center gap-1.5 rounded-(--radius-control) bg-ink-100 px-3 py-1.5 text-[0.75rem] font-semibold text-ink-700 transition-colors hover:bg-ink-200 disabled:opacity-60"
    >
      <RotateCcw aria-hidden className="size-3.5" />
      {t('replay')}
    </button>
  )
}
