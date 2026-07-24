'use client'

import { useRef, useState, useTransition } from 'react'

import { Camera, Loader2, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { setAvatarPath } from '@/app/[locale]/(app)/profile/personal/actions'
import { useRouter } from '@/i18n/navigation'
import { Avatar } from '@/components/profile/Avatar'
import { createClient } from '@/lib/supabase/client'
import { avatarPublicUrl } from '@/lib/profile/avatar'
import { cn } from '@/lib/cn'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * The editable profile picture: the avatar with a camera badge at its foot.
 * Tapping the camera picks an image; it uploads to the user's own folder in
 * the public `avatars` bucket, saves the path on the profile, and replaces the
 * initials. A photo can be removed to fall back to initials again.
 *
 * The upload runs on the browser client (RLS lets a user write only inside
 * {uid}/…); the path is persisted through a server action.
 */
export function AvatarUploader({
  userId,
  name,
  initialPath,
}: {
  userId: string
  name: string | null
  initialPath: string | null
}) {
  const t = useTranslations('personal.avatar')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState<string | null>(initialPath)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const onPick = () => {
    setError(null)
    fileRef.current?.click()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return

    if (!ACCEPTED.includes(file.type)) return setError(t('badType'))
    if (file.size > MAX_BYTES) return setError(t('tooBig'))

    setError(null)
    setBusy(true)
    const supabase = createClient()
    const previous = path
    const next = `${userId}/${crypto.randomUUID()}.${EXT[file.type]}`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(next, file, { contentType: file.type, upsert: false })
    if (upErr) {
      setBusy(false)
      return setError(t('failed'))
    }

    const res = await setAvatarPath(next)
    if (!res.ok) {
      // Roll back the orphaned upload so it doesn't linger.
      await supabase.storage.from('avatars').remove([next])
      setBusy(false)
      return setError(t('failed'))
    }

    // Best-effort cleanup of the replaced file.
    if (previous) await supabase.storage.from('avatars').remove([previous])

    setPath(next)
    setBusy(false)
    startTransition(() => router.refresh())
  }

  const onRemove = () => {
    if (!path) return
    setError(null)
    setBusy(true)
    const previous = path
    startTransition(async () => {
      const res = await setAvatarPath(null)
      if (!res.ok) {
        setBusy(false)
        return setError(t('failed'))
      }
      const supabase = createClient()
      await supabase.storage.from('avatars').remove([previous])
      setPath(null)
      setBusy(false)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <Avatar
          name={name}
          src={avatarPublicUrl(path)}
          className="size-24 text-2xl ring-4 ring-surface shadow-[0_1px_2px_0_rgb(15_23_42/0.06)]"
        />

        {/* Camera badge at the foot of the ring. */}
        <button
          type="button"
          onClick={onPick}
          disabled={busy}
          aria-label={t('change')}
          className={cn(
            'absolute -bottom-1 left-1/2 -translate-x-1/2 grid size-9 place-items-center rounded-full',
            'border-2 border-surface bg-brand-600 text-white shadow-[0_1px_2px_0_rgb(15_23_42/0.2)]',
            'transition-colors hover:bg-brand-700 disabled:opacity-60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
          )}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Camera aria-hidden className="size-4" />
          )}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED.join(',')}
          onChange={onFile}
          className="sr-only"
          tabIndex={-1}
        />
      </div>

      {path && !busy && (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-500 transition-colors hover:text-danger-600"
        >
          <Trash2 aria-hidden className="size-3.5" />
          {t('remove')}
        </button>
      )}

      {error && (
        <p role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}
