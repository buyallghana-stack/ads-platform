'use client'

import { useRef, useState, useTransition } from 'react'

import { Camera, Check, Loader2, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { setAvatarPath } from '@/app/[locale]/(app)/profile/personal/actions'
import { useRouter } from '@/i18n/navigation'
import { Avatar } from '@/components/profile/Avatar'
import { createClient } from '@/lib/supabase/client'
import { avatarPublicUrl } from '@/lib/profile/avatar'
import { compressAvatar } from '@/lib/profile/compress-image'
import { cn } from '@/lib/cn'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

/*
  What may be CHOSEN, not what is uploaded — every picture is shrunk to a few
  tens of kilobytes first (see compressAvatar). The limit is generous because a
  photo straight off a modern phone is routinely 5-12 MB, and refusing those
  would mean telling people to go and resize a picture themselves, which is
  exactly the work this now does for them. It exists only to keep a phone from
  trying to decode something absurd.
*/
const MAX_BYTES = 15 * 1024 * 1024

/*
  And what may be UPLOADED if compression could not run at all — an old browser
  with no usable canvas. Small enough that the fallback can never put a
  megabyte on the wire; the bucket enforces its own ceiling underneath, since
  the browser is not the last word on what reaches storage.
*/
const MAX_UNCOMPRESSED_BYTES = 400 * 1024
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
 *
 * The photo saves the moment it is chosen, independently of the name/phone
 * form below — deliberate, because on a flaky mobile connection the worst
 * outcome is uploading a photo and losing it to a navigation before pressing
 * Save. That makes it essential to SAY so: without confirmation the untouched
 * "Save changes" button (correctly disabled, nothing pending) reads as "your
 * photo could not be saved". Hence the explicit saved-state below.
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
  const [done, setDone] = useState<'updated' | 'removed' | null>(null)
  const [, startTransition] = useTransition()

  const onPick = () => {
    setError(null)
    setDone(null)
    fileRef.current?.click()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return

    if (!ACCEPTED.includes(file.type)) return setError(t('badType'))
    if (file.size > MAX_BYTES) return setError(t('tooBig'))

    setError(null)
    setDone(null)
    setBusy(true)

    /*
      Shrunk BEFORE the upload, so the slow part never happens on the sender's
      connection either. compressAvatar returns the original file rather than
      throwing when it cannot work, which is why the size is re-checked after:
      "compression did not run" must not become "a 12 MB photo was uploaded".
    */
    const image = await compressAvatar(file)
    if (image.size > MAX_UNCOMPRESSED_BYTES) {
      setBusy(false)
      return setError(t('couldNotShrink'))
    }

    const supabase = createClient()
    const previous = path
    const next = `${userId}/${crypto.randomUUID()}.${EXT[image.type] ?? 'jpg'}`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(next, image, { contentType: image.type, upsert: false })
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
    setDone('updated')
    setBusy(false)
    startTransition(() => router.refresh())
  }

  const onRemove = () => {
    if (!path) return
    setError(null)
    setDone(null)
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
      setDone('removed')
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

      {/* The photo is already saved at this point — say it plainly, so the
          disabled "Save changes" button below is not read as a failure. */}
      {done && !busy && !error && (
        <p className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-success-600">
          <Check aria-hidden className="size-3.5" />
          {t(done)}
        </p>
      )}

      {error && (
        <p role="alert" className="text-[0.75rem] font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}
