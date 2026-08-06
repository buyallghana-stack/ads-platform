-- ============================================================================
-- Migration 140 — products get a face, and the things a course page needs
--
-- Compared against the operator's references, the shop was a skeleton. The
-- diagnosis was a series of individually defensible "we do not have that data"
-- decisions that together left a card with nothing on it to look at.
--
-- The worst of them was self-inflicted: `products.cover_path` has existed since
-- migration 107 and `shop_products` already RETURNS it. Nothing ever wrote to
-- it, because the admin editor had no upload — so the shop rendered a gradient
-- placeholder instead, with a comment calling that "a designed state". It was
-- not a designed state, it was a missing feature with a nice excuse attached.
--
-- ---------------------------------------------------------------------------
-- COVERS ARE PUBLIC, AND THAT IS DELIBERATE
--
-- `course-media` is private because paid lessons live in it and a permanent
-- unauthenticated URL to a GHS 400 course is catastrophic (E32, DECISIONS §4).
--
-- A cover is the opposite kind of object. It is marketing: it has to be
-- readable by a signed-OUT stranger following an affiliate link, and it is
-- fetched once per card on a browse screen. Serving it through short-lived
-- signed URLs would defeat CDN caching and add a round trip per card on a
-- mobile connection, in exchange for hiding an image whose entire job is to be
-- seen.
--
-- So a separate PUBLIC bucket, and the private one keeps its meaning. Two
-- buckets whose names say what they are beats one bucket with a rule about
-- which prefixes are secret.
--
-- ---------------------------------------------------------------------------
-- WHAT ELSE THE REFERENCES NEED THAT NOTHING STORED
--
--   learning_outcomes   0578's "What'll you learn" — a two-column checklist.
--                       The single most valuable block on a course sales page
--                       and there was nowhere to put it.
--   category            0572's filter chips. Free text rather than an enum:
--                       the operator adds a topic when they add a product, and
--                       an enum would need a migration every time.
--
-- Deliberately NOT added: ratings and review counts. Nothing generates them,
-- and a five-star row on a product nobody has reviewed is fabricated social
-- proof on something being sold for real money. The references have them
-- because they have reviewers.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-covers', 'product-covers', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

/* Anyone may READ a cover — that is the point of the bucket. Only a super
   admin may write one, matching `assert_admin` on every catalogue RPC and the
   `course-media` policies from migration 134. `is_admin()` is NOT used here for
   the same reason as there: it is true for support agents. */
create policy "Anyone reads product covers"
  on storage.objects for select
  using (bucket_id = 'product-covers');

create policy "Super admins upload product covers"
  on storage.objects for insert
  with check (bucket_id = 'product-covers' and public.is_super_admin((select auth.uid())));

create policy "Super admins update product covers"
  on storage.objects for update
  using (bucket_id = 'product-covers' and public.is_super_admin((select auth.uid())))
  with check (bucket_id = 'product-covers' and public.is_super_admin((select auth.uid())));

create policy "Super admins delete product covers"
  on storage.objects for delete
  using (bucket_id = 'product-covers' and public.is_super_admin((select auth.uid())));

alter table public.products
  add column if not exists learning_outcomes text[] not null default '{}',
  add column if not exists category text;

comment on column public.products.learning_outcomes is
  'Short "what you will learn" lines, shown as a checklist on the product page. Not marketing copy — each line should be a thing the buyer can do afterwards.';
comment on column public.products.category is
  'Free-text topic, used for the shop filter chips. Free text rather than an enum so adding a topic is not a migration.';
