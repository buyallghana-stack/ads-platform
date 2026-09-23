'use client'

import { useTransition } from 'react'

import { RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
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
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      leadingIcon={<RotateCcw />}
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
    >
      {t('replay')}
    </Button>
  )
}
