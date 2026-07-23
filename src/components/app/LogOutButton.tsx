'use client'

import { useTransition } from 'react'

import { LogOut } from 'lucide-react'

import { logOutAction } from '@/app/[locale]/(auth)/actions'
import { Button } from '@/components/ui/Button'
import { useRouter } from '@/i18n/navigation'

export function LogOutButton({ label }: { label: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      leadingIcon={<LogOut />}
      onClick={() =>
        startTransition(async () => {
          await logOutAction()
          // refresh() clears the cached Server Component tree; without it the
          // signed-in header can persist after the session is gone.
          router.replace('/login')
          router.refresh()
        })
      }
    >
      {label}
    </Button>
  )
}
