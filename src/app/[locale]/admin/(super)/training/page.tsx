import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { TrainingBoard } from '@/components/admin/TrainingBoard'
import { listProducts } from '@/lib/admin/catalogue-data'

export const metadata: Metadata = {
  title: 'Admin · Training',
  robots: { index: false, follow: false },
}

/**
 * The affiliate training programmes, on their own.
 *
 * ── WHY THIS IS NOT JUST A FILTER ON THE CATALOGUE ──
 *
 * The catalogue has had a Training tab since it was built, and the operator
 * still reported "there is nothing to distinguish the training program course
 * from other courses and ebooks". Two reasons, and the tab fixes neither:
 *
 *   1. The toolbar strip collapses to a `<select>` below `xl`, because four
 *      tabs do not fit — so on any window narrower than 1280px the tab is not
 *      a tab, it is an option inside a dropdown nobody opens.
 *
 *   2. A training programme is not a product with a different `purpose`. It
 *      is the thing that GATES the affiliate business: its completion decides
 *      who may promote at all, its rate is what recruiting an affiliate pays,
 *      and it carries a validity period and a certificate that no vendor
 *      product has. Those fields have nowhere to live on a shared row.
 *
 * So it gets a screen where the numbers that matter are in front of the
 * operator rather than three clicks inside a product editor.
 */
export default async function AdminTrainingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.training')

  const rows = (await listProducts()).filter((p) => p.purpose === 'training_program')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TrainingBoard rows={rows} />
    </>
  )
}
