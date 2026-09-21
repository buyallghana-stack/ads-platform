import { describe, expect, it } from 'vitest'

import { HAS_DB, createAdmin, createUser, withRollback, type Tx } from '../support/db'

/**
 * The advertiser's logo has to survive the whole trip.
 *
 * An ad carries three things about who paid for it: the label, the logo, and
 * nothing else. The label has always reached the card; the logo is new, and
 * the interesting part is not the column — it is `get_ad_feed`, which had to
 * be DROPPED and re-created to gain a return column, and a drop puts a
 * function's EXECUTE back to PUBLIC. On this project that has already meant
 * seventeen functions readable with the anon key.
 *
 * So this file checks the value arrives AND that the door did not reopen.
 */

const newAd = async (tx: Tx, logoPath: string | null) => {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.ads (title, advertiser_name, advertiser_logo_path, format, status,
                             points_reward, video_source, youtube_video_id,
                             duration_seconds, min_watch_seconds, weight)
     values ('Logo fixture', 'Kofi Foods', $1, 'video', 'active',
             50, 'youtube', 'dQw4w9WgXcQ', 30, 0, 100)
     returning id`,
    [logoPath],
  )
  const id = rows[0]!.id
  /* ⚠️ Tagged to `free`, or the feed shows this user nothing and every
     assertion below passes against an empty result. */
  await tx.query(
    `insert into public.ad_tiers (ad_id, tier_id)
     select $1::uuid, t.id from public.tiers t where t.slug = 'free'`,
    [id],
  )
  return id
}

const feedRow = async (tx: Tx, userId: string, adId: string) => {
  const { rows } = await tx.query<{ advertiser_name: string; advertiser_logo_path: string | null }>(
    `select advertiser_name, advertiser_logo_path
       from public.get_ad_feed($1, null, 50) where id = $2`,
    [userId, adId],
  )
  return rows[0]
}

describe.skipIf(!HAS_DB)('an advertiser logo on the feed', () => {
  it('reaches the card with the name it belongs to', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      const ad = await newAd(tx, 'logo/6f1c.webp')

      expect(await feedRow(tx, user.id, ad)).toEqual({
        advertiser_name: 'Kofi Foods',
        advertiser_logo_path: 'logo/6f1c.webp',
      })
    })
  })

  it('is null when nobody uploaded one, rather than missing', async () => {
    await withRollback(async (tx) => {
      const user = await createUser(tx)
      const ad = await newAd(tx, null)

      /* Null is the card's instruction to draw the initial. The distinction
         matters: an absent COLUMN would be a TypeScript error at the mapper,
         a null value is the designed fallback. */
      expect(await feedRow(tx, user.id, ad)).toEqual({
        advertiser_name: 'Kofi Foods',
        advertiser_logo_path: null,
      })
    })
  })

  it('kept the feed shut to the anon key after the drop and re-create', async () => {
    await withRollback(async (tx) => {
      const { rows } = await tx.query<{ role: string; allowed: boolean }>(
        `select r.rolname as role,
                has_function_privilege(r.rolname, p.oid, 'execute') as allowed
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
          where n.nspname = 'public' and p.proname = 'get_ad_feed'
          order by r.rolname`,
      )

      expect(rows).toEqual([
        { role: 'anon', allowed: false },
        { role: 'authenticated', allowed: true },
        { role: 'service_role', allowed: true },
      ])
    })
  })

  it('is saved and read back by the admin editor', async () => {
    await withRollback(async (tx) => {
      const admin = await createAdmin(tx)

      const { rows: saved } = await tx.query<{ admin_save_ad: string }>(
        `select public.admin_save_ad($1, $2::jsonb, '[]'::jsonb, null)`,
        [
          admin.id,
          JSON.stringify({
            title: 'Keyed in the admin',
            advertiser_name: 'Kofi Foods',
            advertiser_logo_path: 'logo/abc1.webp',
            format: 'video',
            status: 'draft',
            points_reward: 50,
            video_source: 'youtube',
            youtube_video_id: 'dQw4w9WgXcQ',
            duration_seconds: 30,
            min_watch_seconds: 0,
          }),
        ],
      )

      const id = saved[0]!.admin_save_ad
      const { rows } = await tx.query<{ ad: { advertiser_logo_path: string | null } }>(
        `select public.admin_get_ad($1, $2) as ad`,
        [admin.id, id],
      )

      /* Round trip, not just the insert: `admin_get_ad` builds its payload
         from `to_jsonb(a)`, so a column the editor cannot see would be a
         column the editor silently clears on the next save. */
      expect(rows[0]!.ad.advertiser_logo_path).toBe('logo/abc1.webp')
    })
  })
})
