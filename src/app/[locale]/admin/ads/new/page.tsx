import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { AdEditor } from '@/components/admin/AdEditor'
import { blankDraft, duplicateDraft } from '@/lib/admin/ad-draft'
import { getAdDraft, getAdEditorContext } from '@/lib/admin/ads-data'
import type { AdFormat } from '@/lib/admin/types'

export const metadata: Metadata = {
  title: 'Admin · New ad',
  robots: { index: false, follow: false },
}

/**
 * Creating an ad, and duplicating one.
 *
 * `?from=<id>` loads an existing ad and hands the editor a copy — same
 * questions, same targeting, no id, back to draft and with its delivery reset.
 * Duplicating through the editor rather than with a "copy" button on the list
 * is deliberate: a copied ad almost always needs one thing changed before it
 * should serve, and this way the operator is already looking at it.
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

  const context = await getAdEditorContext()

  const source = from ? await getAdDraft(from) : null
  const initial = source
    ? duplicateDraft(source, t('copySuffix'))
    : blankDraft((format === 'survey' ? 'survey' : 'video') as AdFormat)

  return <AdEditor initial={initial} tiers={context.tiers} pointsPerGhs={context.pointsPerGhs} />
}
