'use server'

import { revalidatePath } from 'next/cache'

import { z } from 'zod'

import { getSessionUser } from '@/lib/auth/session'
import { reportUnexpected } from '@/lib/observability/report'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Writes for the Phase 2 catalogue: products, vendors, sections, lessons,
 * quizzes and resources.
 *
 * Every one goes through the SERVICE client, because the admin_* RPCs are
 * revoked from `authenticated`. That is not a bypass — each takes the acting
 * admin's id and calls `assert_admin` itself, and the id comes from the
 * verified session here, never from the payload a browser sent.
 *
 * ⚠️ `assert_admin` is SUPER ADMIN. Authoring the catalogue is not delegated to
 * the ads or support roles, so the database refuses them even though the nav
 * does not offer the link.
 *
 * The shapes are validated here as well as in Postgres. The client's opinion of
 * its own validity is not evidence, and the RPCs take a single jsonb blob —
 * which is convenient to build and easy to send garbage into.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; message: string }

const fail = (message: string): ActionResult<never> => ({ ok: false, message })

/** Resolves the acting admin, or refuses. */
async function actor(): Promise<string | null> {
  const user = await getSessionUser()
  return user?.id ?? null
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

const productSchema = z.object({
  id: z.string().uuid().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  kind: z.enum(['course', 'ebook', 'bundle']),
  purpose: z.enum(['vendor_product', 'training_program']).optional(),
  title: z.string().trim().min(1, 'A product needs a title.').max(160),
  /* Lowercase, hyphenated, and permanent once set — the RPC refuses a change
     because the slug is in the URL a buyer may already have bookmarked and in
     every affiliate link pointing at it. */
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers and hyphens, like sales-mastery.')
    .max(80),
  description: z.string().trim().max(4000).optional(),
  contentLanguage: z.string().trim().max(8).optional(),
  priceGhs: z.number().nonnegative().max(1_000_000),
  /* `null` CLEARS a sale; omitting the key leaves it alone. The RPC keys off
     presence rather than coalesce for exactly this reason, so the schema has
     to be able to express the difference too. */
  salePriceGhs: z.number().nonnegative().max(1_000_000).nullable().optional(),
  saleStartsAt: z.string().nullable().optional(),
  saleEndsAt: z.string().nullable().optional(),
  minAffiliateTier: z.enum(['beginner', 'professional']).optional(),
  /* Added in migration 140. All three use key PRESENCE in the RPC so that a
     cleared value is distinguishable from an untouched one — which is why they
     are nullable rather than merely optional. */
  coverPath: z.string().nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  outcomes: z.array(z.string().trim().max(300)).max(12).optional(),
})

export async function saveProductAction(
  input: z.input<typeof productSchema>,
): Promise<ActionResult<{ id: string }>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const parsed = productSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'That does not look right.')

  /*
    A sale price at or above the full price is not a sale, and it silently
    reduces commission — which is charged on what was actually paid — without
    reducing what the buyer pays. Caught here because it is a business mistake
    rather than a data one, and Postgres has no opinion about it.
  */
  const sale = parsed.data.salePriceGhs
  if (typeof sale === 'number' && sale >= parsed.data.priceGhs) {
    return fail('A sale price has to be below the full price.')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_product', {
    p_admin_id: adminId,
    p_product: parsed.data as never,
  })

  if (error) {
    reportUnexpected(error, 'catalogue.saveProduct')
    return fail(error.message)
  }

  revalidatePath('/admin/catalogue')
  return { ok: true, data: { id: (data as { id: string }).id } }
}

export async function setProductStatusAction(
  productId: string,
  status: 'draft' | 'published' | 'paused',
): Promise<ActionResult> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const supabase = createAdminClient()
  const { error } = await supabase.rpc('admin_set_product_status', {
    p_admin_id: adminId,
    p_product_id: productId,
    p_status: status,
  })

  /*
    The refusal message is shown verbatim. `admin_set_product_status` raises
    with the first publish blocker and a count of the rest — "This course has
    no lessons yet (and 0 more)" — which is far more use than a generic
    failure, and it is the same text the blocker list on the page shows.
  */
  if (error) return fail(error.message)

  revalidatePath('/admin/catalogue')
  revalidatePath(`/admin/catalogue/${productId}`)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Vendors                                                             */
/* ------------------------------------------------------------------ */

const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'A vendor needs a name.').max(160),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().email('That email does not look right.').or(z.literal('')).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(4000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
})

export async function saveVendorAction(
  input: z.input<typeof vendorSchema>,
): Promise<ActionResult<{ id: string }>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const parsed = vendorSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'That does not look right.')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_vendor', {
    p_admin_id: adminId,
    p_vendor: parsed.data as never,
  })

  if (error) {
    reportUnexpected(error, 'catalogue.saveVendor')
    return fail(error.message)
  }

  revalidatePath('/admin/vendors')
  return { ok: true, data: { id: (data as { id: string }).id } }
}

/* ------------------------------------------------------------------ */
/* Curriculum                                                          */
/* ------------------------------------------------------------------ */

export async function saveSectionAction(input: {
  id?: string
  productId: string
  title: string
  position?: number
}): Promise<ActionResult<{ id: string }>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')
  if (!input.title.trim()) return fail('A section needs a title.')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_section', {
    p_admin_id: adminId,
    p_section: input as never,
  })
  if (error) return fail(error.message)

  revalidatePath(`/admin/catalogue/${input.productId}/curriculum`)
  return { ok: true, data: { id: (data as { id: string }).id } }
}

const lessonSchema = z.object({
  id: z.string().uuid().optional(),
  sectionId: z.string().uuid(),
  title: z.string().trim().min(1, 'A lesson needs a title.').max(200),
  kind: z.enum(['video', 'article', 'pdf', 'quiz']),
  position: z.number().int().nonnegative().optional(),
  body: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  isPreview: z.boolean().optional(),
})

export async function saveLessonAction(
  input: z.input<typeof lessonSchema>,
  productId: string,
): Promise<ActionResult<{ id: string }>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const parsed = lessonSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'That does not look right.')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_lesson', {
    p_admin_id: adminId,
    p_lesson: parsed.data as never,
  })
  if (error) return fail(error.message)

  revalidatePath(`/admin/catalogue/${productId}/curriculum`)
  return { ok: true, data: { id: (data as { id: string }).id } }
}

export async function reorderAction(
  what: 'sections' | 'lessons',
  parentId: string,
  ids: string[],
  productId: string,
): Promise<ActionResult> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const supabase = createAdminClient()
  const { error } =
    what === 'sections'
      ? await supabase.rpc('admin_reorder_sections', {
          p_admin_id: adminId,
          p_product_id: parentId,
          p_section_ids: ids,
        })
      : await supabase.rpc('admin_reorder_lessons', {
          p_admin_id: adminId,
          p_section_id: parentId,
          p_lesson_ids: ids,
        })

  if (error) return fail(error.message)
  revalidatePath(`/admin/catalogue/${productId}/curriculum`)
  return { ok: true }
}

export async function deleteAction(
  what: 'section' | 'lesson' | 'question' | 'resource',
  id: string,
  productId: string,
): Promise<ActionResult> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const fn = {
    section: 'admin_delete_section',
    lesson: 'admin_delete_lesson',
    question: 'admin_delete_quiz_question',
    resource: 'admin_delete_resource',
  }[what] as 'admin_delete_section'

  const arg = {
    section: 'p_section_id',
    lesson: 'p_lesson_id',
    question: 'p_question_id',
    resource: 'p_resource_id',
  }[what]

  const supabase = createAdminClient()
  const { error } = await supabase.rpc(fn, {
    p_admin_id: adminId,
    [arg]: id,
  } as never)

  if (error) return fail(error.message)
  revalidatePath(`/admin/catalogue/${productId}/curriculum`)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Quizzes                                                             */
/* ------------------------------------------------------------------ */

export async function saveQuizAction(
  input: {
    id?: string
    lessonId: string
    title: string
    /** Seconds into the video for a checkpoint; null for a section quiz. */
    atSeconds: number | null
    passPercent: number
    position?: number
  },
  productId: string,
): Promise<ActionResult<{ id: string }>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')
  if (!input.title.trim()) return fail('A quiz needs a title.')
  if (input.passPercent < 1 || input.passPercent > 100) {
    return fail('The pass mark has to be between 1 and 100.')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_quiz', {
    p_admin_id: adminId,
    p_quiz: input as never,
  })
  if (error) return fail(error.message)

  revalidatePath(`/admin/catalogue/${productId}/curriculum`)
  return { ok: true, data: { id: (data as { id: string }).id } }
}

const questionSchema = z.object({
  id: z.string().uuid().optional(),
  quizId: z.string().uuid(),
  prompt: z.string().trim().min(1, 'A question needs a prompt.').max(1000),
  explanation: z.string().trim().max(1000).optional(),
  position: z.number().int().nonnegative().optional(),
  options: z
    .array(
      z.object({
        body: z.string().trim().min(1, 'An option cannot be blank.').max(500),
        isCorrect: z.boolean(),
      }),
    )
    .min(2, 'A question needs at least two options.'),
})

export async function saveQuestionAction(
  input: z.input<typeof questionSchema>,
  productId: string,
): Promise<ActionResult<{ id: string }>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const parsed = questionSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'That does not look right.')

  /*
    Exactly one correct answer. `lesson_is_ready` already refuses to publish a
    question with none, but catching it at save time is the difference between
    finding out now and finding out at publish, after writing forty questions.

    More than one is refused too: the learner-facing quiz sends a single option
    id per question, so a second correct answer is unreachable — it would sit
    in the database looking like it counted while being impossible to choose.
  */
  const correct = parsed.data.options.filter((o) => o.isCorrect).length
  if (correct === 0) return fail('Mark one option as the correct answer.')
  if (correct > 1) return fail('Only one option can be correct — learners pick a single answer.')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_quiz_question', {
    p_admin_id: adminId,
    p_question: parsed.data as never,
  })
  if (error) return fail(error.message)

  revalidatePath(`/admin/catalogue/${productId}/curriculum`)
  return { ok: true, data: { id: data as string } }
}

export async function deleteQuizAction(
  quizId: string,
  productId: string,
): Promise<ActionResult> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const supabase = createAdminClient()
  const { error } = await supabase.rpc('admin_delete_quiz', {
    p_admin_id: adminId,
    p_quiz_id: quizId,
  })
  if (error) return fail(error.message)

  revalidatePath(`/admin/catalogue/${productId}/curriculum`)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Commission                                                          */
/* ------------------------------------------------------------------ */

const commissionSchema = z.object({
  productId: z.string().uuid(),
  /* Percent of the sale price, both levels. The table's own CHECK allows only
     'percent', so there is no rate-type to choose. */
  l1: z.number().min(0).max(100),
  l2: z.number().min(0).max(100),
  windowHours: z.number().int().min(1).max(8760),
  holdDays: z.number().int().min(0).max(365),
  active: z.boolean(),
})

/**
 * What a product pays an affiliate.
 *
 * ⚠️ THIS IS THE FIRST WRITE PATH `affiliate_programs` HAS EVER HAD. Two rows
 * were seeded by a migration and nothing could add a third, so every vendor
 * product created through the catalogue arrived with no programme, no rate,
 * and no way for an affiliate to earn on it.
 *
 * Changing a rate is safe with respect to money already earned:
 * `conversions.l1_rate` is frozen onto the row at attribution time and the
 * ledger credit is computed from that, so this only ever affects sales that
 * have not happened yet.
 */
export async function saveCommissionAction(
  input: z.input<typeof commissionSchema>,
): Promise<ActionResult<void>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const parsed = commissionSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'That does not look right.')

  const { productId, l1, l2, windowHours, holdDays, active } = parsed.data
  if (l1 + l2 > 100) return fail('The two levels together cannot be more than 100%.')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_save_affiliate_program', {
    p_admin_id: adminId,
    p_product_id: productId,
    p_l1: l1,
    p_l2: l2,
    p_window_hours: windowHours,
    p_hold_days: holdDays,
    p_active: active,
  })

  if (error) {
    reportUnexpected(error, 'catalogue.saveCommission')
    return fail(error.message)
  }

  const outcome = (data as { outcome?: string } | null)?.outcome
  if (outcome === 'over_100') return fail('The two levels together cannot be more than 100%.')
  if (outcome === 'not_found') return fail('That product no longer exists.')
  if (outcome !== 'ok') return fail('Could not save the commission.')

  revalidatePath('/admin/catalogue')
  return { ok: true }
}

/** Take the product out of the affiliate marketplace entirely. */
export async function removeCommissionAction(productId: string): Promise<ActionResult<void>> {
  const adminId = await actor()
  if (!adminId) return fail('You are not signed in.')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_remove_affiliate_program', {
    p_admin_id: adminId,
    p_product_id: productId,
  })

  if (error) {
    reportUnexpected(error, 'catalogue.removeCommission')
    return fail(error.message)
  }

  const outcome = (data as { outcome?: string } | null)?.outcome
  if (outcome === 'has_sales') {
    return fail('Affiliates have already earned on this product. Pause it instead of removing it.')
  }
  if (outcome !== 'ok') return fail('Could not remove the commission.')

  revalidatePath('/admin/catalogue')
  return { ok: true }
}
