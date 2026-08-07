import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Read side of the Phase 2 catalogue for the admin.
 *
 * Through the service client, like every other admin read: the RPCs are
 * revoked from `authenticated` and verify the acting admin themselves. The
 * caller passes an id that came from a verified session, never from a payload.
 */

export type CatalogueRow = {
  id: string
  title: string
  slug: string
  kind: string
  purpose: string
  status: 'draft' | 'published' | 'paused'
  vendor_name: string | null
  price_ghs: number
  sale_price_ghs: number | null
  effective_price_ghs: number
  content_language: string
  min_affiliate_tier: 'beginner' | 'professional'
  lessons: number
  sections: number
  /** How many things stand between this product and being publishable. */
  blockers: number
  cover_path: string | null
  category: string | null
  description: string | null
  learning_outcomes: string[]
  /** Percent of the sale price. Null means the product has NO affiliate
   *  programme at all, which is different from a programme paying 0%: the
   *  first cannot be promoted, the second pays nothing for promoting it. */
  l1_rate: number | null
  l2_rate: number | null
  attribution_window_hours: number | null
  hold_days: number | null
  commission_status: 'active' | 'paused' | null
  sales: number
  revenue_ghs: number
  created_at: string
}

export type VendorRow = {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  status: string
  products: number
  created_at: string
}

export type CurriculumRow = {
  section_id: string
  section_title: string
  section_position: number
  lesson_id: string | null
  lesson_title: string | null
  lesson_position: number | null
  kind: 'video' | 'article' | 'pdf' | 'quiz' | null
  duration_seconds: number | null
  is_preview: boolean | null
  resource_count: number
  quiz_count: number
  question_count: number
  /** Learners who have already opened this lesson. Deleting is destructive
   *  once this is above zero, so the UI has to say so. */
  learners_started: number
  /** Null when the lesson is ready; otherwise what is missing. */
  problem: string | null
}

export type Section = {
  id: string
  title: string
  position: number
  lessons: CurriculumRow[]
}

export const listProducts = cache(async (purpose?: string): Promise<CatalogueRow[]> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_products', {
    p_purpose: purpose ?? undefined,
  })
  if (error || !data) return []
  return data as unknown as CatalogueRow[]
})

export const listVendors = cache(async (): Promise<VendorRow[]> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_list_vendors')
  if (error || !data) return []
  return data as unknown as VendorRow[]
})

export const getProduct = cache(async (productId: string): Promise<CatalogueRow | null> => {
  // Off the same list the index uses, rather than a second select. The list
  // already carries the derived columns the editor needs — blocker count,
  // lesson count, commission rates — and a bespoke read would be a second
  // definition of what a product looks like.
  const rows = await listProducts()
  return rows.find((r) => r.id === productId) ?? null
})

/**
 * The curriculum, grouped into sections.
 *
 * ⚠️ `admin_course_curriculum` LEFT JOINs lessons, so a section with no
 * lessons still comes back — as one row with a null `lesson_id`. That is
 * deliberate and load-bearing: the admin has to be able to see an empty
 * section in order to delete it or put something in it, and migration 133
 * makes an empty section a publish blocker. The grouping below must therefore
 * not treat a null lesson as "no row".
 */
export const getAdminCurriculum = cache(async (productId: string): Promise<Section[]> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_course_curriculum', {
    p_product_id: productId,
  })
  if (error || !data) return []

  const rows = data as unknown as CurriculumRow[]
  const sections: Section[] = []
  for (const row of rows) {
    let section = sections.find((s) => s.id === row.section_id)
    if (!section) {
      section = {
        id: row.section_id,
        title: row.section_title,
        position: row.section_position,
        lessons: [],
      }
      sections.push(section)
    }
    if (row.lesson_id) section.lessons.push(row)
  }
  return sections
})

/** Everything standing between a product and `published`. */
export const getPublishBlockers = cache(
  async (productId: string): Promise<{ problem: string; lesson_title: string | null }[]> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('product_publish_blockers', {
      p_product_id: productId,
    })
    if (error || !data) return []
    return data as unknown as { problem: string; lesson_title: string | null }[]
  },
)

export type LessonDetail = {
  ok: boolean
  lesson?: {
    id: string
    sectionId: string
    sectionTitle: string
    productId: string
    title: string
    kind: 'video' | 'article' | 'pdf' | 'quiz'
    body: string | null
    storagePath: string | null
    durationSeconds: number | null
    isPreview: boolean
    position: number
  }
  /** Null when ready; otherwise what is missing. Same string the catalogue
   *  and the product editor show, so one lesson never gets two stories. */
  problem?: string | null
  resources?: {
    id: string
    title: string
    storagePath: string
    byteSize: number | null
    position: number
  }[]
  quizzes?: {
    id: string
    title: string
    atSeconds: number | null
    passPercent: number
    position: number
    questions: {
      id: string
      prompt: string
      explanation: string | null
      position: number
      /** ⚠️ Carries `isCorrect`. This read is admin-only for that reason. */
      options: { id: string; body: string; isCorrect: boolean }[]
    }[]
  }[]
}

/**
 * A lesson with its answer key.
 *
 * Deliberately a different function from `lesson_for_learner` rather than the
 * same one with a flag: a boolean that switches the answer key on would sit in
 * a function learners CAN reach, one wrong argument from shipping the answers.
 */
export const getLessonDetail = cache(
  async (adminId: string, lessonId: string): Promise<LessonDetail> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('admin_lesson_detail', {
      p_admin_id: adminId,
      p_lesson_id: lessonId,
    })
    if (error || !data) return { ok: false }
    return data as unknown as LessonDetail
  },
)
