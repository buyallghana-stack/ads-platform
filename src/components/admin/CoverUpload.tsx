'use client'

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Upload, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { coverUrl } from '@/lib/market/covers'
import { createClient } from '@/lib/supabase/client'

/**
 * The product cover.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * `products.cover_path` has been in the schema since migration 107 and the shop
 * read always returned it. Nothing ever wrote to it, because there was no
 * upload — so every card in the shop drew a gradient placeholder, and the
 * placeholder had a comment calling it a design decision. It was a missing
 * feature with an excuse attached, and it is the single biggest reason the shop
 * looked nothing like the references.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC BUCKET, AND THE PREVIEW PROVES IT
 *
 * Covers go to `product-covers`, which is public — unlike `course-media`, where
 * paid lessons live behind 15-minute signed URLs. A cover has to be readable by
 * a signed-out stranger following an affiliate link, and it is fetched once per
 * card on a browse screen; signed URLs would defeat CDN caching to hide an
 * image whose whole job is to be seen.
 *
 * Which is why this component can show a plain <img> preview straight after
 * upload, and the lesson video editor cannot.
 *
 * Uploaded the moment a file is chosen, like every other upload on the
 * platform: on a flaky connection the worst outcome is sending the bytes and
 * then losing them to a navigation.
 */

/* The bucket's own ceiling is 5 MB. Checked here too so an oversized file is
   refused instantly rather than after the operator has waited. */
const MAX_BYTES = 5 * 1024 * 1024

export function CoverUpload({
  productId,
  path,
  onChange,
}: {
  /** Null while creating — there is no id to file the image under yet. */
  productId: string | null
  path: string | null
  onChange: (path: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const url = coverUrl(path)

  async function choose(file: File | undefined) {
    if (!file || !productId) return
    setProblem(null)

    if (file.size > MAX_BYTES) {
      setProblem('That image is over 5 MB. Compress it and try again.')
      return
    }

    setBusy(true)
    try {
      const extension = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
      /* Foldered by product and named for the moment, so replacing a cover
         cannot be defeated by a cached URL pointing at the old bytes. */
      const key = `${productId}/cover-${Date.now()}.${extension}`

      const supabase = createClient()
      const { error } = await supabase.storage.from('product-covers').upload(key, file, {
        contentType: file.type,
        upsert: false,
      })

      if (error) {
        setProblem(`That upload did not work: ${error.message}`)
        return
      }
      onChange(key)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  if (!productId) {
    return (
      <p className="rounded-(--radius-input) border border-dashed border-ink-300 px-3 py-4 text-[0.8125rem] text-ink-500">
        Save the product first, then add a cover.
      </p>
    )
  }

  return (
    <div>
      <div
        className={cn(
          'relative overflow-hidden rounded-(--radius-card) border border-ink-200',
          'aspect-[16/10] w-full max-w-sm bg-ink-100',
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a just-uploaded
          // key is not in any Next image cache yet, and the point of this
          // preview is to show the bytes that actually landed.
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-ink-400">
            <ImageIcon aria-hidden className="size-8" strokeWidth={1.25} />
          </span>
        )}

        {path && (
          <button
            type="button"
            aria-label="Remove the cover"
            title="Remove the cover"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-surface/90 text-ink-600 backdrop-blur-sm transition-colors hover:text-danger-600"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={cn(
          'mt-2.5 inline-flex items-center gap-2 rounded-(--radius-input) border border-ink-200 bg-surface',
          'px-3.5 py-2 text-[0.8125rem] font-semibold text-ink-800 transition-colors',
          'hover:border-ink-300 disabled:opacity-50',
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Upload aria-hidden className="size-4" />
        )}
        {busy ? 'Uploading…' : path ? 'Replace the cover' : 'Choose a cover'}
      </button>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        onChange={(e) => void choose(e.target.files?.[0])}
      />

      <p className="mt-1.5 text-[0.75rem] text-ink-500">
        Landscape, at least 1200×675. This is the first thing anyone sees in the shop.
      </p>

      {problem && (
        <p role="alert" className="mt-2 text-[0.75rem] font-medium text-danger-600">
          {problem}
        </p>
      )}
    </div>
  )
}
