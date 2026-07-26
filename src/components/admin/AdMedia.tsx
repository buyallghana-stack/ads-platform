'use client'

import { useRef, useState } from 'react'

import { Film, ImageIcon, Loader2, MonitorPlay, Upload, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { youtubeId } from '@/lib/admin/ad-draft'
import type { AdDraft } from '@/lib/admin/types'
import { adMediaUrl } from '@/lib/ads/media'
import { cn } from '@/lib/cn'
import { createClient } from '@/lib/supabase/client'

import { Field, FieldSet, inputClass, Segmented } from './FormBits'

/**
 * Where the video comes from, and what the card looks like.
 *
 * TWO SOURCES, DELIBERATELY DIFFERENT SHAPES
 * A YouTube ad is a link the operator pastes; an in-house ad is a file they
 * upload to our own bucket. The database models exactly one of the two per
 * ad (`ads_video_shape`), so the form does too — switching source clears the
 * other side rather than leaving a stale path behind that the constraint
 * would reject at save time with a name nobody can read.
 *
 * UPLOADS SAVE THEMSELVES, IMMEDIATELY
 * The file goes to storage the moment it is chosen, not when the form is
 * submitted, and the path is what the form holds. This is the same decision
 * the avatar upload made and for the same reason: on a flaky connection the
 * worst outcome is uploading 40 MB of video and then losing it to a
 * navigation. A file that ends up unreferenced is cleaned up by the save
 * action; a file that was never uploaded is 40 MB of the operator's data
 * spent for nothing.
 *
 * The browser client is the uploader because the `ad-media` policies check
 * `is_admin()` on the caller's own token — which is the correct check, and
 * one the service key would only bypass.
 */

const MAX_BYTES = 100 * 1024 * 1024

export function AdMedia({
  draft,
  error,
  onChange,
}: {
  draft: AdDraft
  error?: string
  onChange: (patch: Partial<AdDraft>) => void
}) {
  const t = useTranslations('admin.ads.editor')

  return (
    <div className="flex flex-col gap-4">
      <FieldSet label={t('videoSource')} error={error}>
        <Segmented
          value={draft.videoSource ?? 'youtube'}
          label={t('videoSource')}
          onChange={(source) =>
            onChange(
              source === 'youtube'
                ? { videoSource: 'youtube', storagePath: null }
                : { videoSource: 'upload', youtubeId: null },
            )
          }
          options={[
            { value: 'youtube', label: t('sourceYoutube'), icon: <MonitorPlay /> },
            { value: 'upload', label: t('sourceUpload'), icon: <Film /> },
          ]}
        />
      </FieldSet>

      {draft.videoSource === 'youtube' ? (
        <YoutubeField draft={draft} onChange={onChange} />
      ) : (
        <UploadField
          label={t('videoFile')}
          hint={t('videoFileHint')}
          accept="video/mp4,video/webm,video/quicktime"
          path={draft.storagePath}
          folder="video"
          onUploaded={(storagePath, meta) =>
            onChange({
              storagePath,
              // A file knows how long it is; making the operator type it in
              // and get it wrong would mis-set the watch requirement, which
              // is what pays people.
              durationSeconds: meta?.duration ?? draft.durationSeconds,
            })
          }
          onClear={() => onChange({ storagePath: null })}
        />
      )}

      <UploadField
        label={t('thumbnail')}
        hint={draft.videoSource === 'youtube' ? t('thumbnailHintYoutube') : t('thumbnailHint')}
        accept="image/jpeg,image/png,image/webp"
        path={draft.thumbnailPath}
        folder="thumb"
        image
        onUploaded={(thumbnailPath) => onChange({ thumbnailPath })}
        onClear={() => onChange({ thumbnailPath: null })}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function YoutubeField({
  draft,
  onChange,
}: {
  draft: AdDraft
  onChange: (patch: Partial<AdDraft>) => void
}) {
  const t = useTranslations('admin.ads.editor')
  // What the operator typed, kept separate from the id we store: they paste a
  // URL and we keep 11 characters, so echoing the stored value back into the
  // box would rewrite their input under their cursor.
  const [typed, setTyped] = useState(draft.youtubeId ?? '')
  const id = youtubeId(typed)

  return (
    <Field
      label={t('youtubeLink')}
      hint={id ? t('youtubeResolved', { id }) : t('youtubeHint')}
      error={typed.trim() && !id ? t('errors.youtubeUnreadable') : undefined}
    >
      <div className="flex gap-3">
        <input
          value={typed}
          placeholder="https://www.youtube.com/watch?v=…"
          onChange={(e) => {
            setTyped(e.target.value)
            onChange({ youtubeId: youtubeId(e.target.value) })
          }}
          className={inputClass(Boolean(typed.trim() && !id))}
        />
        {id && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://i.ytimg.com/vi/${id}/default.jpg`}
            alt=""
            className="h-10 w-[4.5rem] shrink-0 rounded-(--radius-input) border border-ink-200 object-cover"
          />
        )}
      </div>
    </Field>
  )
}

/* ------------------------------------------------------------------ */

function UploadField({
  label,
  hint,
  accept,
  path,
  folder,
  image,
  onUploaded,
  onClear,
}: {
  label: string
  hint: string
  accept: string
  path: string | null
  /** Prefix inside the bucket, so videos and stills stay separable. */
  folder: 'video' | 'thumb'
  image?: boolean
  onUploaded: (path: string, meta?: { duration: number | null }) => void
  onClear: () => void
}) {
  const t = useTranslations('admin.ads.editor')
  const input = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const url = adMediaUrl(path)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setProblem(null)

    if (file.size > MAX_BYTES) {
      setProblem(t('errors.fileTooBig'))
      return
    }

    setBusy(true)
    try {
      const duration = image ? null : await readDuration(file)
      const extension = (file.name.split('.').pop() ?? 'bin').toLowerCase().slice(0, 5)
      const key = `${folder}/${crypto.randomUUID()}.${extension}`

      const supabase = createClient()
      const { error } = await supabase.storage.from('ad-media').upload(key, file, {
        contentType: file.type,
        upsert: false,
      })

      if (error) {
        setProblem(t('errors.uploadFailed'))
        return
      }

      onUploaded(key, { duration })
    } finally {
      setBusy(false)
      // Let the same file be picked again after a failure.
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <p className="text-[0.75rem] font-medium text-ink-700">{label}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {path && url && (
          <span className="flex min-w-0 items-center gap-2 rounded-(--radius-input) border border-ink-200 bg-canvas py-1.5 pr-2.5 pl-1.5">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt=""
                className="size-8 shrink-0 rounded-[0.4rem] bg-ink-100 object-cover"
              />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-[0.4rem] bg-ink-100 text-ink-500">
                <Film aria-hidden className="size-4" />
              </span>
            )}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-[0.75rem] font-medium text-ink-700 underline-offset-2 hover:underline"
            >
              {path.split('/').pop()}
            </a>
            <button
              type="button"
              onClick={onClear}
              aria-label={t('removeFile')}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        )}

        <label
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-(--radius-input) border border-ink-200 bg-surface',
            'px-3 py-2 text-[0.75rem] font-semibold text-ink-600 transition-colors hover:text-ink-900',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : image ? (
            <ImageIcon aria-hidden className="size-3.5" />
          ) : (
            <Upload aria-hidden className="size-3.5" />
          )}
          {busy ? t('uploading') : path ? t('replaceFile') : t('chooseFile')}
          <input
            ref={input}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </label>
      </div>

      {problem ? (
        <p role="alert" className="mt-1 text-[0.6875rem] font-medium text-danger-600">
          {problem}
        </p>
      ) : (
        <p className="mt-1 text-[0.625rem] leading-snug text-ink-400">{hint}</p>
      )}
    </div>
  )
}

/**
 * How long the chosen film is, read from the file itself.
 *
 * Resolves null rather than rejecting when the browser cannot decode it — an
 * unreadable duration is a field the operator fills in, not a failed upload.
 */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }

    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration) : null)
    video.onerror = () => done(null)
    video.src = url
  })
}
