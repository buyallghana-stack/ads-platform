import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AdEditor } from '@/components/admin/AdEditor'
import { AdFormatChooser } from '@/components/admin/AdFormatChooser'
import { blankDraft, duplicateDraft } from '@/lib/admin/ad-draft'
import { getAdDraft, getAdEditorContext } from '@/lib/admin/ads-data'
import type { AdFormat } from '@/lib/admin/types'

export const metadata: Metadata = {
  title: 'Admin · New ad',
  robots: { index: false, follow: false },
}

const FORMATS: AdFormat[] = ['video', 'survey', 'link']

/**
 * Creating an ad, and duplicating one.
 *
 * `?from=<id>` loads an existing ad and hands the editor a copy — same
 * questions, same targeting, no id, back to draft and with its delivery reset.
 * Duplicating through the editor rather than with a "copy" button on the list
 * is deliberate: a copied ad almost always needs one thing changed before it
 * should serve, and this way the operator is already looking at it.
 *
 * WITHOUT A FORMAT it asks which one rather than assuming video. There are
 * three since 2026-07-31 and they are genuinely different products — a film,
 * a questionnaire, an article that pays for a click — so the pool's toolbar
 * carries ONE "New ad" button and the choice is made here, with a sentence
 * against each. Three buttons in that toolbar would have been three truncated
 * labels on a phone, and a fourth format would make it four.
 */
export default async function NewAdPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ format?: string; from?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { format, from } = await searchParams
  const t = await getTranslations('admin.ads.editor')

  const chosen = FORMATS.find((f) => f === format) ?? null

  // The chooser needs none of the editor's context, so it answers before any
  // of it is fetched.
  if (!chosen && !from) return <AdFormatChooser />

  const context = await getAdEditorContext()

  const source = from ? await getAdDraft(from) : null
  const initial = source
    ? duplicateDraft(source, t('copySuffix'))
    : blankDraft(chosen ?? 'video', context.linkDwellSeconds)

  return <AdEditor initial={initial} tiers={context.tiers} pointsPerGhs={context.pointsPerGhs} />
}
