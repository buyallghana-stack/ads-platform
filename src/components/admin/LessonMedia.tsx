'use client'

import { useRef, useState } from 'react'
import { Film, Loader2, Upload, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { createClient } from '@/lib/supabase/client'

/**
 * The video file for a lesson.
 *
 * ---------------------------------------------------------------------------
 * IT UPLOADS THE MOMENT THE FILE IS CHOSEN
 *
 * Same decision as the ad pool and the avatar, for the same reason: on a flaky
 * connection the worst outcome is sending 300 MB and then losing it to a
 * navigation. A file that ends up unreferenced is a tidy-up job; a file that
 * was never uploaded is 300 MB of somebody's data spent for nothing.
 *
 * ---------------------------------------------------------------------------
 * THE BROWSER UPLOADS DIRECTLY, AND ONLY A SUPER ADMIN CAN
 *
 * Posting the file to a server action and forwarding it with the service key
 * would route a 300 MB video through a serverless function to reach a place the
 * browser can already write to. Migration 134 added the storage policies that
 * make the direct path work.
 *
 * Those policies check `is_super_admin`, NOT `is_admin` — `is_admin()` is true
 * for support agents, and giving support read access to this bucket would let
 * anyone handling a password-reset ticket download every paid course. That is
 * the exact thing the private bucket exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * NO PREVIEW OF THE UPLOADED FILE
 *
 * `course-media` is private, so there is no URL to put in a <video> tag without
 * minting a signed one. The filename and duration are enough to confirm the
 * right file went up, and the operator can watch it in the learner player.
 */

/* The bucket's own ceiling is 500 MB. Checked here too so an oversized file is
   refused instantly rather than after the operator has waited for the upload
   to fail on the server. */
const MAX_BYTES = 500 * 1024 * 1024

export function LessonMedia({
  productId,
  path,
  durationSeconds,
  onChange,
}: {
  productId: string
  path: string | null
  durationSeconds: number | null
  onChange: (patch: { storagePath?: string | null; durationSeconds?: number | null }) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function choose(file: File | undefined) {
    if (!file) return
    setProblem(null)

    if (file.size > MAX_BYTES) {
      setProblem('That file is over 500 MB. Compress it and try again.')
      return
    }

    setBusy(true)
    try {
      const duration = await readDuration(file)
      const extension = (file.name.split('.').pop() ?? 'mp4').toLowerCase().slice(0, 5)
      /* Foldered by product so the bucket stays navigable, and a random name so
         two lessons called "intro.mp4" cannot collide. */
      const key = `${productId}/${crypto.randomUUID()}.${extension}`

      const supabase = createClient()
      const { error } = await supabase.storage.from('course-media').upload(key, file, {
        contentType: file.type,
        upsert: false,
      })

      if (error) {
        setProblem(`That upload did not work: ${error.message}`)
        return
      }

      onChange({ storagePath: key, durationSeconds: duration })
    } finally {
      setBusy(false)
      // Let the same file be chosen again after a failure.
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-2 rounded-(--radius-input) border border-ink-200 bg-surface',
            'px-3.5 py-2 text-[0.8125rem] font-semibold text-ink-800 transition-colors',
            'hover:border-ink-300 disabled:opacity-50',
          )}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Upload aria-hidden className="size-4" />
          )}
          {busy ? 'Uploading…' : path ? 'Replace the file' : 'Choose a video'}
        </button>

        {path && !busy && (
          <span className="inline-flex min-w-0 items-center gap-2 text-[0.8125rem] text-ink-600">
            <Film aria-hidden className="size-4 shrink-0 text-ink-400" />
            <span className="min-w-0 truncate">{path.split('/').pop()}</span>
            <button
              type="button"
              aria-label="Remove the video"
              title="Remove the video"
              onClick={() => onChange({ storagePath: null, durationSeconds: null })}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(e) => void choose(e.target.files?.[0])}
      />

      {problem && (
        <p role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
          {problem}
        </p>
      )}

      {/* Duration is editable rather than read-only. The browser cannot decode
          every container, and an unreadable duration is a field the operator
          fills in — not a failed upload. It matters because the player uses it
          to say "10 min left". */}
      <div className="mt-3 flex items-center gap-2">
        <label className="text-[0.75rem] font-medium text-ink-700" htmlFor="lesson-duration">
          Length
        </label>
        <input
          id="lesson-duration"
          type="number"
          min="0"
          inputMode="numeric"
          value={durationSeconds ?? ''}
          onChange={(e) =>
            onChange({ durationSeconds: e.target.value === '' ? null : Number(e.target.value) })
          }
          className="w-28 rounded-(--radius-input) border border-ink-200 bg-surface px-3 py-1.5 text-[0.875rem] tabular-nums text-ink-900 pointer-coarse:text-base"
          placeholder="600"
        />
        <span className="text-[0.75rem] text-ink-500">
          seconds{durationSeconds ? ` · ${Math.round(durationSeconds / 60)} min` : ''}
        </span>
      </div>
    </div>
  )
}

/**
 * How long the chosen film is, read from the file itself.
 *
 * Resolves null rather than rejecting when the browser cannot decode it — the
 * operator types it in instead, which is a far better outcome than refusing an
 * upload over a container the browser happens not to understand.
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
