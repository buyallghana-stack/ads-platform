import type { Metadata } from 'next'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { PageHeader } from '@/components/admin/AdminChrome'
import { Planned, PlannedNote } from '@/components/admin/Planned'

export const metadata: Metadata = {
  title: 'Admin · Ads',
  robots: { index: false, follow: false },
}

/**
 * Ads — screen not built yet, scope written down.
 *
 * Listed rather than hidden so the operator can point at a line and say
 * "build that next", the way the Profile hub was worked through.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('admin.ads')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PlannedNote ready={true}>{t('note')}</PlannedNote>
      <Planned
        items={[
          { title: 'Pool list', body: 'Every ad and survey with its format, status, reward, completions against budget, and which plans it targets.', backend: 'admin_list_ads()' },
          { title: 'Create and edit', body: 'Ad, questions, options, skip-logic rules and tier targeting saved in one transaction.', backend: 'admin_save_ad()' },
          { title: 'Tier targeting', body: "Pick one or more plans, or leave it empty for everyone. Inclusive by default so upgrading never shrinks a user's pool.", backend: 'ad_tiers + ad_targeting_includes_lower_tiers' },
          { title: 'Branching editor', body: 'Show a question only when an earlier answer matches. Rules may only look backwards, which the database enforces.', backend: 'ad_question_rules' },
          { title: 'Cue points', body: 'The second of a video at which each question interrupts, or the end.', backend: 'ad_questions.show_at_seconds' },
          { title: 'Media upload', body: 'Thumbnails and uploaded videos into the ad-media bucket.', backend: 'ad-media bucket (admin write)' },
          { title: 'Remove from pool', body: 'Deletes outright only while nobody has attempted it; archives after that so the evidence behind paid completions survives.', backend: 'admin_delete_ad()' },
          { title: 'Answer keys', body: 'Tick an answer to make a question graded, or leave it blank so any answer is accepted.' },
        ]}
      />
    </>
  )
}
