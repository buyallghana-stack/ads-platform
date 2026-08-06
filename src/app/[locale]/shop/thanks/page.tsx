import { CheckCircle2 } from 'lucide-react'
import { setRequestLocale } from 'next-intl/server'

import { MarketHeader } from '@/components/market/MarketHeader'
import { Link, redirect } from '@/i18n/navigation'
import { getViewerUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * After a purchase.
 *
 * Reads the order rather than trusting the query string, so a hand-typed
 * `?order=` cannot produce a "thank you for your purchase" for something
 * nobody bought — and so the page can name what was actually delivered.
 */
export default async function ThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ order?: string }>
}) {
  const { locale } = await params
  const { order } = await searchParams
  setRequestLocale(locale)

  const user = await getViewerUser()
  if (!user) redirect({ href: '/login', locale })
  if (!order) redirect({ href: '/shop', locale })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('orders')
    .select('id, status, user_id, products(title, slug, purpose)')
    /* `redirect` above throws, but TypeScript does not know that from a
       helper, so the narrowing has to be restated. */
    .eq('id', order!)
    .maybeSingle()

  // Somebody else's order, or one that never completed.
  if (!row || row.user_id !== user!.id || row.status !== 'confirmed') {
    redirect({ href: '/shop', locale })
  }

  const product = row!.products as unknown as {
    title: string
    slug: string
    purpose: string
  }

  return (
    <>
      <MarketHeader title="Thank you" />
      <div className="mx-auto w-full max-w-lg px-4 py-10 text-center sm:px-6">
        <CheckCircle2 aria-hidden className="mx-auto size-10 text-jade-600" strokeWidth={1.5} />
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-ink-900">
          {product.title} is yours
        </h1>

        <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-snug text-ink-600">
          {product.purpose === 'training_program'
            ? 'Your affiliate account has been created. Finish enough of the course and it switches on, and you can start promoting.'
            : 'It is in your library and ready to open.'}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href={`/learn/${product.slug}`}
            className="rounded-(--radius-input) bg-jade-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-jade-700"
          >
            Start it now
          </Link>
          <Link
            href="/market"
            className="rounded-(--radius-input) border border-ink-200 px-5 py-2.5 text-sm font-semibold text-ink-800 transition-colors hover:border-ink-300"
          >
            Go to Market
          </Link>
        </div>
      </div>
    </>
  )
}
