import 'server-only'

import { cookies, headers } from 'next/headers'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Remembering which affiliate sent somebody here.
 *
 * ---------------------------------------------------------------------------
 * WITHOUT THIS, NOBODY IS EVER PAID
 *
 * The commission ledger, the conversions table and the whole payout queue are
 * downstream of one thing: a click row existing before the order is confirmed.
 * If this never runs, every sale still completes, every product is still
 * delivered, and no affiliate earns a pesewa — with no error raised anywhere,
 * because nothing is technically wrong. It is the quietest possible failure in
 * Phase 2, which is why it lives in its own file with this comment on it.
 *
 * ---------------------------------------------------------------------------
 * THE VISITOR TOKEN IS MINTED IN MIDDLEWARE, NOT HERE
 *
 * A first-party cookie, set the first time anybody arrives with a `ref`. It is
 * a random id and nothing else — no user id, no affiliate code, nothing that
 * identifies a person if it leaks.
 *
 * ⚠️ This module used to set it, and it silently did nothing: `cookies().set()`
 * during a Server Component render is a no-op, because the response headers are
 * committed before a component runs. The click was recorded against a token the
 * browser never kept, so attribution found nothing and the sale paid nobody.
 * `src/middleware.ts` mints it now, on both the request and the response, and
 * this module only ever READS it.
 *
 * It lasts THIRTY DAYS, matching `attribution_window_hours` (720). Not because
 * the cookie enforces the window — `attribute_order` does that in SQL, against
 * the click's own timestamp — but because a cookie that outlived the window
 * would be dead weight the browser carries for nothing.
 *
 * Clicks bind two ways, cookie AND account, so a click made while logged out
 * still counts when the person signs in to buy. That is C18, and it is most of
 * why the window is useful at all: almost nobody buys on the first visit.
 */

const VISITOR_COOKIE = 'sp_v'

/** The visitor token for this browser, or null if it has never been set. */
export async function getVisitorToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(VISITOR_COOKIE)?.value ?? null
}

/**
 * Records a click and makes sure the browser is carrying a visitor token.
 *
 * Returns the token so a caller mid-render can use it without re-reading the
 * jar — a cookie written during this request is not visible to a read in the
 * same request.
 *
 * Failures are swallowed. A bad or expired `ref` code must not stop somebody
 * reaching a product page: the worst outcome of a missed click is an
 * unattributed sale, and the worst outcome of throwing here is no sale at all.
 */
export async function recordClick(input: {
  code: string
  /* REQUIRED. `affiliate_clicks.product_id` is NOT NULL, so every affiliate
     link is product-specific by design — there is no generic "shop through my
     link". That is a structural fact of the schema rather than a limitation of
     this helper, and it is why the shop index does not record clicks: there is
     no product to attribute one to. */
  productId: string
  userId: string | null
  landingUrl: string
  subid?: string | null
}): Promise<string | null> {
  /* Minted by middleware on the way in, so it is already here. If it is
     somehow not — a route the matcher skips, a client with cookies off — the
     click is still recorded against the ACCOUNT, which is the other half of
     the two-way binding and is what makes a signed-in purchase attributable
     without any cookie at all. */
  const token = (await cookies()).get(VISITOR_COOKIE)?.value ?? null

  try {
    const head = await headers()
    const admin = createAdminClient()
    await admin.rpc('record_affiliate_click', {
      p_affiliate_code: input.code,
      p_product_id: input.productId,
      p_subid: input.subid ?? undefined,
      p_visitor_token: token ?? undefined,
      p_user_id: input.userId ?? undefined,
      /* `x-forwarded-for` is a list; the first entry is the client. Taken
         best-effort — an unparseable address must not cost somebody a click.
         `?? undefined` rather than `|| undefined` on the OUTER value so an
         empty string still collapses to undefined and Postgres gets a null
         inet rather than a cast error on ''. */
      p_ip: (head.get('x-forwarded-for')?.split(',')[0]?.trim() || null) ?? undefined,
      p_user_agent: head.get('user-agent') ?? undefined,
      p_referrer: head.get('referer') ?? undefined,
      p_landing_url: input.landingUrl,
    })
  } catch {
    // Deliberately silent. See the note above.
  }

  return token
}
