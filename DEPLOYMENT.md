# Deployment

## Why `cdg1`

`vercel.json` pins serverless functions to **Paris (cdg1)**, matching the
Supabase project's `eu-west-3` region.

This is not cosmetic. Vercel's default is `iad1` (Washington DC), which would
put roughly 90 ms of transatlantic latency on **every database round trip** —
and the ad-view path makes several per request. §8 names that path a release
blocker. Same continent as the database, functions and users: ~1 ms instead.

If the plan does not permit choosing a region, set it manually under
**Project Settings → Functions → Region**, or accept `iad1` and revisit before
launch.

## Connecting the repository

The GitHub integration is the right setup here rather than CLI deploys: every
push to `main` deploys automatically, and every branch gets its own preview
URL. That is what makes progress reviewable without asking for a deploy.

1. **vercel.com** → sign in **with GitHub** as buyallghana@gmail.com
2. **Add New… → Project**
3. Import **`buyallghana-stack/ads-platform`**
4. Framework preset should auto-detect **Next.js**. Leave build and output
   settings alone — the defaults are correct.
5. Add the environment variables below **before** the first deploy, or it will
   fail at build time when `src/lib/env.ts` validates them.
6. **Deploy**

## Environment variables

Set for **Production, Preview and Development** unless noted.

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mjivgeojeejaszcrkbbo.supabase.co` | Safe to expose |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Safe to expose; protected by RLS |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | **Secret.** Bypasses RLS entirely |
| `NEXT_PUBLIC_SITE_URL` | the deployed URL | Update once a custom domain exists |
| `PAYOUTS_ENABLED` | `false` | Must stay false until the licence is confirmed |
| `GEO_RESTRICTION_ENABLED` | `false` for now | Set `true` before launch (§6.9) |

To read the local values without echoing the secret into a shell history:

```bash
grep -v '^#' ~/projects/ads/.env.local | grep .
```

`PAYOUTS_ENABLED` is one of **two** switches. The other is the `payouts_enabled`
row in `app_config`. Both must be true before any disbursement runs — two
switches in different systems, both defaulting off, because this is money
leaving the business before a money-service licence exists.

## Plan

Hobby is free but its terms **prohibit commercial use**. Fine for building and
reviewing; a paid plan is required before real advertisers or real users.
Worth knowing now rather than at launch.

## Before the first public link

- `robots: noindex` is already set in the locale layout, so nothing gets
  indexed while the platform is incomplete.
- Supabase Auth needs the deployed origin added under
  **Authentication → URL Configuration → Redirect URLs**, or email
  confirmation links will bounce.
- The Ghana-only geo restriction is not implemented yet. `GEO_RESTRICTION_ENABLED`
  exists and defaults to false; the middleware check lands with the auth work.
