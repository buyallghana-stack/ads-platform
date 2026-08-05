-- ============================================================================
-- Migration 109 — PHASE 2, step 3a of 7: orders and entitlements (TABLES ONLY)
--
-- The confirm / grant / refund FUNCTIONS are deliberately NOT in this
-- migration. Those are money-touching logic and therefore gate G4, which the
-- brief says needs its own written approval with a plan presented first. This
-- migration is the schema those functions will act on, which is gate G2 and
-- already approved.
--
-- Nothing in Phase 1 is touched. In particular `subscription_payments` is left
-- exactly as it is — see §2 for why Phase 2 gets its own orders table rather
-- than borrowing the one that already works.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

do $$ begin
  /* Three kinds, because they behave differently where it matters most:
     a RENEWAL must never create a conversion or pay commission (B11c), and an
     UPGRADE is charged as the difference and pays commission on that
     difference (B8). Making the kind explicit is what stops a renewal being
     routed through the first-purchase path, which is the single easiest way
     to start paying the residual recruitment income the Owner ruled out. */
  create type public.order_kind as enum ('purchase', 'training_renewal', 'training_upgrade');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending', 'confirmed', 'refunded', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_payment_method as enum ('paystack', 'crypto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entitlement_status as enum ('active', 'expired', 'revoked');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. Orders
-- ---------------------------------------------------------------------------
--
-- A NEW TABLE RATHER THAN AN EXTENSION OF `subscription_payments`, and this is
-- a deliberate refusal rather than duplication by accident. That table is live
-- Phase 1 money code: it has its own reference index, its own confirm RPC, and
-- the referral commission path hooks into that RPC. Widening it to carry
-- product orders would put Phase 2 inside the Phase 1 money path — a gate G1
-- change to working code, for no benefit beyond having one fewer table.
--
-- TWO PRICES ARE STORED, and that is the point rather than redundancy.
-- Commission was decided on `amount_minor` — what the buyer actually paid —
-- because a percentage of the list price can pay out more commission than a
-- discounted sale brought in. `list_price_minor` is kept so a report can show
-- what a discount cost in commission terms, and so the rule stays revisitable
-- without the history being lost.

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  product_id       uuid not null references public.products(id),
  kind             public.order_kind not null default 'purchase',

  amount_minor     bigint not null,       -- what was charged. The commission base.
  list_price_minor bigint not null,       -- what it would have cost undiscounted
  currency_code    text not null default 'GHS',

  method           public.order_payment_method not null,
  provider_ref     text,
  status           public.order_status not null default 'pending',
  confirmed_at     timestamptz,
  refunded_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint orders_amount_sane check (amount_minor >= 0),
  constraint orders_list_sane   check (list_price_minor >= 0),

  /* Charging MORE than the list price is never a discount, an upgrade or a
     renewal — it is an inverted assignment, and this catches it at the write
     rather than in a commission figure somebody queries three weeks later. */
  constraint orders_amount_not_above_list check (amount_minor <= list_price_minor),

  /* A confirmed order has a time it was confirmed; a refunded one was
     confirmed first. Without this, `status` and the timestamps can disagree,
     and every report that filters on one while reading the other is wrong in a
     way that looks like a data problem rather than a constraint problem. */
  constraint orders_confirmed_has_time
    check (status <> 'confirmed' or confirmed_at is not null),
  constraint orders_refunded_was_confirmed
    check (status <> 'refunded' or (confirmed_at is not null and refunded_at is not null))
);

comment on table public.orders is
  'Phase 2 product purchases. Separate from subscription_payments, which is Phase 1 plan money and must not be widened.';
comment on column public.orders.amount_minor is
  'What the buyer actually paid. THIS is the commission base (decided 2026-08-05), not the list price.';

/*
  THE IDEMPOTENCY GUARD. One provider reference confirms one order, which is
  what makes a replayed Paystack webhook harmless. Phase 1 learned this the
  same way and its index has the same shape; partial, because a pending order
  has no reference yet and several of those may legitimately exist.
*/
create unique index if not exists orders_provider_ref_idx
  on public.orders (provider_ref) where provider_ref is not null;

create index if not exists orders_user_idx    on public.orders (user_id, created_at desc);
create index if not exists orders_product_idx on public.orders (product_id, status);
create index if not exists orders_confirmed_idx
  on public.orders (confirmed_at desc) where status = 'confirmed';

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

alter table public.orders enable row level security;

create policy orders_own on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

/* Writes are service-client only. An order decides what somebody owns and what
   commission is paid on it; a client that could insert one could grant itself
   a course and pay its own upline. */


-- ---------------------------------------------------------------------------
-- 3. Entitlements
-- ---------------------------------------------------------------------------
--
-- What a user owns, and until when.
--
-- ONE ROW PER USER PER PRODUCT, which is the constraint doing the most work
-- here. Three separate flows can grant the same product to the same person:
-- buying it outright, buying a bundle that contains it, and renewing training.
-- Without the unique key those produce two or three rows and the reader has to
-- decide which one is authoritative — usually by picking the wrong one. With
-- it, every flow is an upsert that EXTENDS what is already there.
--
-- `expires_at is null` means permanent, which is every vendor product. Only
-- training expires (B11), and even then only the RIGHT TO PROMOTE expires —
-- the content itself stays readable for good, because taking away a course
-- somebody paid for is what produces refund demands. That distinction lives in
-- step 4, where affiliate entitlements are separate rows from these.

create table if not exists public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  order_id    uuid not null references public.orders(id),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  status      public.entitlement_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, product_id)
);

comment on table public.entitlements is
  'What a user owns. One row per user per product: buying outright, buying a bundle that contains it, and renewing all upsert onto the same row.';
comment on column public.entitlements.order_id is
  'The order that most recently granted or extended this. Not necessarily the first one — a bundle or a renewal replaces it.';
comment on column public.entitlements.expires_at is
  'Null means permanent, which is every vendor product. Training access is also permanent; it is the right to PROMOTE that expires, and that lives on affiliate_entitlements.';

create index if not exists entitlements_user_idx on public.entitlements (user_id);
create index if not exists entitlements_expiring_idx
  on public.entitlements (expires_at) where expires_at is not null and status = 'active';

drop trigger if exists entitlements_touch_updated_at on public.entitlements;
create trigger entitlements_touch_updated_at
  before update on public.entitlements
  for each row execute function public.touch_updated_at();

alter table public.entitlements enable row level security;

create policy entitlements_own on public.entitlements
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());


-- ---------------------------------------------------------------------------
-- 4. Does this person own it?
-- ---------------------------------------------------------------------------
--
-- The question every content route asks before minting a signed URL. A
-- function rather than a query repeated in each caller, so there is one place
-- to be wrong and one place to fix.
--
-- Preview lessons are NOT handled here: previewing is a property of a lesson,
-- not of an entitlement, and mixing them would let a product with one preview
-- lesson accidentally unlock its paid ones.

create or replace function public.has_entitlement(p_user_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
     where e.user_id = p_user_id
       and e.product_id = p_product_id
       and e.status = 'active'
       and (e.expires_at is null or e.expires_at > now())
  );
$$;

comment on function public.has_entitlement(uuid, uuid) is
  'Whether this user may open this product right now. The single check in front of every signed URL.';

revoke execute on function public.has_entitlement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.has_entitlement(uuid, uuid) to service_role;

/* Service role only, and deliberately so. It takes a user id as a parameter
   and does not ask who is calling — which is safe for something only the
   server can reach, and exactly the shape that made fifteen functions
   readable with the publishable key earlier today. */
