-- ============================================================================
-- Migration 107 — PHASE 2, step 1 of 7: the catalogue
--
-- Vendors, products and bundles. The first tables of the second business.
-- Approved at gate G2 on 2026-08-05 against
-- `PHASE2 - Architecture and Schema Proposal (G2).md`.
--
-- NOTHING HERE TOUCHES PHASE 1. No existing table, function or policy is
-- altered. That is the standing rule for this phase (brief §0.4 / gate G1):
-- Phase 2 is additive, and any behaviour change to the ads business is a bug
-- unless it was asked for.
--
-- Naming: everything in this phase is `affiliate_*` / product-domain. Phase 1's
-- `referral_*` tables are a DIFFERENT system that pays points — they are not
-- related to anything here and must never share a table or a function. The two
-- are far easier to confuse than they look, because since migration 083 Phase 1
-- referrals also pay two levels and also pay a percentage of a purchase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.vendor_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  -- A bundle is a product that contains products. It is deliberately a KIND
  -- rather than a flag, so the check constraints below can talk about it.
  create type public.product_kind as enum ('course', 'ebook', 'bundle');
exception when duplicate_object then null; end $$;

do $$ begin
  /* The same content engine serves both (brief §3.3). A training program IS a
     course; what differs is what buying it entitles you to. Storing that as a
     column rather than a separate table is what stops a second, parallel
     "training" system existing. */
  create type public.product_purpose as enum ('vendor_product', 'training_program');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.product_status as enum ('draft', 'published', 'paused');
exception when duplicate_object then null; end $$;

do $$ begin
  /* ORDERED, and that is the point. D23 was decided as a MINIMUM tier, not an
     exact match: Professional may promote everything Beginner may. Postgres
     compares enum values by declaration order, so `>=` works directly and a
     third tier inserted later with `alter type ... add value ... after` keeps
     every existing comparison correct. A text column compared with `=` was the
     rejected alternative. */
  create type public.affiliate_tier as enum ('beginner', 'professional');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. Vendors
-- ---------------------------------------------------------------------------
--
-- A closed network: companies approach the Owner offline and he creates the
-- record. No vendor login, no portal, no self-serve (A2, brief §11). Reporting
-- is a CSV the admin exports and emails by hand (A3).
--
-- There is deliberately NO vendor payable ledger (A4). The Owner licenses the
-- product outright, so the system never tracks money owed to a vendor. If that
-- ever changes it is a new ledger and its own milestone, not a column added
-- here.

create table if not exists public.vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  status        public.vendor_status not null default 'active',
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vendors_name_present check (length(btrim(name)) > 0)
);

comment on table public.vendors is
  'Companies whose products are sold on the platform. Admin-created; vendors have no login and no portal.';

create index if not exists vendors_status_idx on public.vendors (status, name);

drop trigger if exists vendors_touch_updated_at on public.vendors;
create trigger vendors_touch_updated_at
  before update on public.vendors
  for each row execute function public.touch_updated_at();

alter table public.vendors enable row level security;

/* No policy at all. Vendor contact details are private commercial information
   and no user-facing screen reads them — the admin console goes through
   SECURITY DEFINER functions on the service client. With RLS on and no policy,
   a client query returns nothing even if a grant is ever added by mistake.
   Today's lesson, the expensive way: `create function` hands EXECUTE to PUBLIC
   by default, so "nobody granted it" is not a safe assumption. */


-- ---------------------------------------------------------------------------
-- 3. Products
-- ---------------------------------------------------------------------------

create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid references public.vendors(id),
  kind             public.product_kind not null,
  purpose          public.product_purpose not null default 'vendor_product',
  title            text not null,
  slug             text not null unique,
  description      text,
  cover_path       text,

  /* H49. The language the CONTENT is in, which is not the language the
     interface is in. Without it a French speaker buys an English course and
     finds out after paying — a refund and a support contact, both avoidable. */
  content_language text not null default 'en',

  /* A6 — every pricing style the Owner asked for is ONE mechanism, not three.
     A plain price is `sale_price_minor is null`. A discount is a sale price
     with no window. Launch pricing is a sale price with an end date. The
     effective price is computed by `product_price_minor()` below and never
     stored twice, so the catalogue and the checkout cannot drift apart. */
  price_minor      bigint not null,
  sale_price_minor bigint,
  sale_starts_at   timestamptz,
  sale_ends_at     timestamptz,

  /* D23, as a MINIMUM. `professional >= beginner` by enum order. */
  min_affiliate_tier public.affiliate_tier not null default 'beginner',

  status           public.product_status not null default 'draft',
  published_at     timestamptz,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint products_title_present check (length(btrim(title)) > 0),
  constraint products_slug_format   check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint products_price_sane    check (price_minor >= 0),

  /* A sale price above the list price is not a sale. Equal is allowed: it is
     how a scheduled price change is staged before its window opens. */
  constraint products_sale_price_sane
    check (sale_price_minor is null or (sale_price_minor >= 0 and sale_price_minor <= price_minor)),

  constraint products_sale_window_ordered
    check (sale_starts_at is null or sale_ends_at is null or sale_ends_at > sale_starts_at),

  /* A window with no sale price prices nothing; it would silently do nothing
     and look like a bug in the checkout rather than in the product. */
  constraint products_sale_window_needs_price
    check (sale_price_minor is not null or (sale_starts_at is null and sale_ends_at is null)),

  /* A training program is the Owner's own content (B5/A2) — it has no vendor.
     Enforced rather than trusted, because `vendor_id` on a training program
     would put somebody else's name against the product that grants affiliate
     eligibility. */
  constraint products_training_has_no_vendor
    check (purpose = 'vendor_product' or vendor_id is null)
);

comment on table public.products is
  'Everything sold on the platform: vendor courses and ebooks, plus the Owner''s own training programs. Same table, distinguished by `purpose`.';
comment on column public.products.price_minor is
  'List price in minor units. The price actually charged is product_price_minor(), which applies any active sale.';
comment on column public.products.min_affiliate_tier is
  'The LOWEST affiliate tier permitted to promote this product. Compared with >=, never =, so Professional is a superset of Beginner.';

create index if not exists products_status_idx   on public.products (status, published_at desc);
create index if not exists products_vendor_idx   on public.products (vendor_id) where vendor_id is not null;
create index if not exists products_purpose_idx  on public.products (purpose, status);

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

alter table public.products enable row level security;

/* The ONE client-readable thing in this migration, and only what a shopper
   must see. A draft or paused product is not on sale, so it is not readable —
   otherwise the catalogue leaks unreleased titles and prices being staged. */
create policy products_published_readable on public.products
  for select to authenticated
  using (status = 'published');


-- ---------------------------------------------------------------------------
-- 4. Bundles
-- ---------------------------------------------------------------------------
--
-- Decided 2026-08-05: a bundle pays its OWN commission rate on its OWN price;
-- the rates of the products inside it are not consulted. The alternative —
-- apportioning the bundle price across its contents — needs an allocation rule
-- (by list price? evenly? by length?) and every such rule is arguable. One rate
-- is explicable to an affiliate in a sentence, which is what matters when
-- somebody disputes a payment.
--
-- ⚠️ THE CONSEQUENCE THAT MUST NOT BE LOST: commission is one row, but
-- ENTITLEMENTS ARE MANY. Buying a bundle grants access to each contained
-- product, or the buyer owns a bundle and can open nothing. That lands in
-- step 3 with `entitlements`; this comment is the reminder.

create table if not exists public.bundle_items (
  bundle_product_id uuid not null references public.products(id) on delete cascade,
  product_id        uuid not null references public.products(id),
  position          int not null default 0,
  primary key (bundle_product_id, product_id),
  constraint bundle_items_not_self check (bundle_product_id <> product_id)
);

comment on table public.bundle_items is
  'What is inside a bundle. Commission is charged on the bundle''s own rate, but entitlements are granted per contained product.';

create index if not exists bundle_items_product_idx on public.bundle_items (product_id);

/*
  NO NESTED BUNDLES, and this is a structural refusal rather than a rule
  somebody remembers. A bundle inside a bundle makes "what does buying this
  grant?" a recursive question, and the entitlement grant in step 3 would have
  to walk a tree of unknown depth. Both sides are checked here so the answer is
  always exactly one level deep.
*/
create or replace function public.bundle_items_shape_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.product_kind;
  v_child  public.product_kind;
begin
  select kind into v_parent from public.products where id = new.bundle_product_id;
  select kind into v_child  from public.products where id = new.product_id;

  if v_parent is distinct from 'bundle' then
    raise exception 'Only a bundle can contain products' using errcode = 'check_violation';
  end if;

  if v_child = 'bundle' then
    raise exception 'A bundle cannot contain another bundle' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists bundle_items_shape on public.bundle_items;
create trigger bundle_items_shape
  before insert or update on public.bundle_items
  for each row execute function public.bundle_items_shape_guard();

alter table public.bundle_items enable row level security;

create policy bundle_items_readable on public.bundle_items
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
       where p.id = bundle_items.bundle_product_id and p.status = 'published'
    )
  );


-- ---------------------------------------------------------------------------
-- 5. What a product actually costs right now
-- ---------------------------------------------------------------------------
--
-- The single answer to "what is the price?", used by the catalogue, the
-- product page, the checkout and the commission base alike. Stored once,
-- derived everywhere — a second cached column is how a screen ends up quoting
-- a figure the checkout will not honour, which is the exact drift the flexible
-- plan pricing work spent a session removing from Phase 1.

create or replace function public.product_price_minor(p_product_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case
           when p.sale_price_minor is not null
            and (p.sale_starts_at is null or p.sale_starts_at <= now())
            and (p.sale_ends_at   is null or p.sale_ends_at   >  now())
             then p.sale_price_minor
           else p.price_minor
         end
    from public.products p
   where p.id = p_product_id;
$$;

comment on function public.product_price_minor(uuid) is
  'What this product costs right now, applying any active sale window. The single source of truth for price; never cache the result in a column.';

/* Readable by a signed-in shopper — it answers about published products they
   can already see, and the checkout needs it. Not granted to anon: the
   catalogue is behind a login, and today proved that leaving `public` on a
   function is how things end up readable with the publishable key. */
revoke execute on function public.product_price_minor(uuid) from public, anon;
grant execute on function public.product_price_minor(uuid) to authenticated, service_role;
