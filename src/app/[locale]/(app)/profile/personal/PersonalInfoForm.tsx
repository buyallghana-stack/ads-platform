'use client'

import { useState, useTransition } from 'react'

import { Check, Phone, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { updatePersonalInfo } from './actions'
import { Button } from '@/components/ui/Button'
import { ReadOnlyField } from '@/components/ui/ReadOnlyField'
import { TextField } from '@/components/ui/TextField'
import { useRouter } from '@/i18n/navigation'
import { personalSchema } from '@/lib/validation/personal'

/**
 * Name + phone, editable as often as the user likes. Validates on the client
 * for a fast message and again on the server (the boundary). "Saved" clears as
 * soon as the user edits again, so the confirmation always refers to the
 * current values.
 */
export function PersonalInfoForm({
  defaultName,
  momoPhone,
  providerName,
  email,
}: {
  defaultName: string
  momoPhone: string | null
  providerName?: string | null
  email: string
}) {
  const t = useTranslations('personal')
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const dirty = name !== defaultName

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)

    const parsed = personalSchema.safeParse({ fullName: name })
    if (!parsed.success) return setError(t(`errors.${parsed.error.issues[0].message}`))

    startTransition(async () => {
      const res = await updatePersonalInfo({ fullName: name })
      if (!res.ok) {
        setError(res.errorKey ? t(`errors.${res.errorKey}`) : (res.message ?? t('errors.generic')))
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField
        label={t('fields.name')}
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setSaved(false)
        }}
        leadingIcon={<UserRound />}
        autoComplete="name"
        maxLength={80}
        required
      />

      <ReadOnlyField
        label={t('fields.phone')}
        value={momoPhone ? `${momoPhone}${providerName ? ` (${providerName})` : ''}` : t('fields.noMomoPhone')}
        leadingIcon={<Phone />}
        hint={t('fields.phoneHint')}
      />

      {/* Same reason as the change-email screen: a disabled input clips a
          long address with no way to read the rest. */}
      <ReadOnlyField
        label={t('fields.email')}
        value={email}
        leadingIcon={<span className="text-[0.9rem]">@</span>}
        hint={t('fields.emailHint')}
      />

      {error && (
        <p role="alert" className="text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={pending} disabled={!dirty}>
          {t('save')}
        </Button>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-600">
            <Check aria-hidden className="size-4" />
            {t('saved')}
          </span>
        )}
      </div>
    </form>
  )
}
