-- ============================================================================
-- Migration 178 — coupon codes: the table, the rules, and the admin
--
-- Operator, 2026-08-11. A coupon is managed in the admin dashboard, belongs to
-- one business, names one tier or one training programme, takes a percentage
-- or a fixed amount off, and has a quota.
--
-- ── A COUPON ALWAYS NAMES ITS TARGET, AND THAT IS THE WHOLE SAFETY MODEL ──
--
-- Operator: *"as far as i set the tier band discount it applies to that tier.
-- so a code which is not designated to a band tier cant be used"*. That is
-- enforced here in the schema rather than in a function somebody could forget:
-- `coupons_targets_one_business` refuses a row that does not name exactly one
-- tier (ads) or exactly one product (affiliate).
--
-- It matters more than it looks. Ads plans are price BANDS, and what somebody
-- pays inside the band sets their points per ad and their daily limit. Because
-- a code names its tier, it can never move anybody between bands: it reduces
-- the money the business receives, not the plan the buyer holds. So
-- `resolve_user_tier` needs no change at all, and the split is carried instead
-- by two amounts on the payment, which migration 179 adds.
--
-- ── WHAT COUNTS AS A USE, AND WHY THERE IS NO COUNTER COLUMN ──
--
-- The obvious build is `used_count` incremented at checkout. It goes wrong the
-- same way twice: an abandoned checkout eats a place in the quota forever, and
-- this platform HAS abandoned checkouts that nothing ever closes (a Paystack
-- transaction left `pending` on 2026-07-31 looked exactly like a real one).
--
-- So a use is counted, never stored: a redemption counts if its payment was
-- CONFIRMED, or if it is still young enough to be somebody with the Paystack
-- page open right now (`coupon_hold_minutes`). An abandoned checkout stops
-- counting on its own after that, with no cron, no release path and no counter
-- to drift. The cost is one small aggregate per validation, over a table that
-- holds one row per redemption of one code.
--
-- The race is closed by locking the coupon row (`for update`) while a checkout
-- validates and inserts, so two people cannot both take the last place.
--
-- ── THE FLOOR UNDER THE CHARGE ──
--
-- A discount may not take the amount payable below `coupon_min_charge_minor`
-- (GHS 1 by default). Paystack cannot charge zero, and a checkout that reaches
-- it would fail after the buyer had already been told the price. A coupon that
-- would go further is clamped to the floor rather than refused, so "GHS 100
-- off" on a GHS 65 plan charges GHS 1 rather than erroring at the till.
--
-- ── THE GUARD THAT ONLY EXISTS BECAUSE OF THE COMMISSION RULE ──
--
-- The operator chose (2026-08-11) that an affiliate is paid on the FULL LIST
-- PRICE of a discounted sale, so their earnings never shrink because the
-- platform ran a promotion. That inverts a guarantee the ledger was built on:
-- commission could never exceed the money the sale brought in. Training pays
-- 20% at level one and 5% at level two, so a discount past 75% would pay out
-- more than came in.
--
-- `admin_save_coupon` refuses such a coupon and names the number. It is
-- checked at creation rather than at redemption because a coupon that cannot
-- be honoured must not exist in the first place: refusing it at the till would
-- mean somebody printed it on a flyer first.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Types and tables
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'coupon_business') then
    create type public.coupon_business as enum ('ads', 'affiliate');
  end if;
  if not exists (select 1 from pg_type where typname = 'coupon_discount_kind') then
    create type public.coupon_discount_kind as enum ('percent', 'fixed');
  end if;
end;
$$;

create table if not exists public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  business            public.coupon_business not null,

  /* Exactly one of these, matching the business. A coupon with no target
     cannot be created, which is the operator's rule made structural. */
  tier_id             uuid references public.tiers(id) on delete cascade,
  product_id          uuid references public.products(id) on delete cascade,

  discount_kind       public.coupon_discount_kind not null,
  /* One column per kind rather than one "value" that means two things. A
     single numeric column is how a percentage ends up charged as pesewas. */
  percent             numeric(6,3),
  amount_minor        bigint,
  /* The cash cap, on percentages only. The operator's choice on 2026-08-11:
     the percentage comes off whatever the buyer chose inside the band, so the
     worst case has to be a number the operator picked rather than one the
     buyer picked by sliding to the top. */
  max_discount_minor  bigint,

  min_spend_minor     bigint  not null default 0,
  quota               int     not null,
  per_user_limit      int     not null default 1,
  first_purchase_only boolean not null default true,

  starts_at           timestamptz,
  ends_at             timestamptz,
  is_active           boolean not null default true,

  note                text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint coupons_code_shape check (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),

  constraint coupons_targets_one_business check (
    (business = 'ads'       and tier_id is not null and product_id is null)
    or
    (business = 'affiliate' and product_id is not null and tier_id is null)
  ),

  constraint coupons_value_matches_kind check (
    (discount_kind = 'percent' and percent is not null and percent > 0 and percent <= 100
                               and amount_minor is null)
    or
    (discount_kind = 'fixed'   and amount_minor is not null and amount_minor > 0
                               and percent is null and max_discount_minor is null)
  ),

  constraint coupons_quota_sane          check (quota >= 1),
  constraint coupons_per_user_sane       check (per_user_limit >= 1 and per_user_limit <= quota),
  constraint coupons_min_spend_sane      check (min_spend_minor >= 0),
  constraint coupons_cap_sane            check (max_discount_minor is null or max_discount_minor > 0),
  constraint coupons_window_sane         check (ends_at is null or starts_at is null or ends_at > starts_at)
);

/* Case does not survive a WhatsApp broadcast, a keyboard on a phone, or
   somebody reading a code off a poster. Codes are stored upper-case (the shape
   check enforces it) and matched upper-case. */
create unique index if not exists coupons_code_idx on public.coupons (upper(code));
create index if not exists coupons_tier_idx    on public.coupons (tier_id)    where tier_id is not null;
create index if not exists coupons_product_idx on public.coupons (product_id) where product_id is not null;

drop trigger if exists coupons_touch_updated_at on public.coupons;
create trigger coupons_touch_updated_at
  before update on public.coupons
  for each row execute function public.touch_updated_at();


create table if not exists public.coupon_redemptions (
  id                      uuid primary key default gen_random_uuid(),
  coupon_id               uuid not null references public.coupons(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,

  /* Exactly one, and it is what makes a use countable: the payment it belongs
     to is where "did this actually complete" is written down. */
  subscription_payment_id uuid references public.subscription_payments(id) on delete cascade,
  order_id                uuid references public.orders(id) on delete cascade,

  list_minor              bigint not null,
  discount_minor          bigint not null,
  charged_minor           bigint not null,
  created_at              timestamptz not null default now(),

  constraint coupon_redemptions_one_payment check (
    (subscription_payment_id is not null and order_id is null)
    or
    (subscription_payment_id is null and order_id is not null)
  ),
  constraint coupon_redemptions_money_sane check (
    list_minor >= 0 and discount_minor >= 0 and charged_minor >= 0
    and discount_minor <= list_minor
    and charged_minor = list_minor - discount_minor
  )
);

/* One redemption per payment, so a replayed webhook or a retried action cannot
   record the same use twice. */
create unique index if not exists coupon_redemptions_payment_idx
  on public.coupon_redemptions (subscription_payment_id) where subscription_payment_id is not null;
create unique index if not exists coupon_redemptions_order_idx
  on public.coupon_redemptions (order_id) where order_id is not null;
create index if not exists coupon_redemptions_coupon_user_idx
  on public.coupon_redemptions (coupon_id, user_id);


alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

/* Codes are not browsable. A user learns a code because somebody gave it to
   them, and the only way to ask about one is `coupon_quote`, which answers for
   ONE code at a time and is rate-limited by having to be typed. Listing them
   would hand every signed-in account the whole promotion calendar. */
create policy coupons_admin_only on public.coupons
  for select to authenticated using (public.is_admin());

create policy coupon_redemptions_own on public.coupon_redemptions
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());


insert into public.app_config (key, value, value_type, description)
values
  ('coupon_hold_minutes', '60', 'int',
   'How long an unconfirmed checkout keeps its place in a coupon quota. A place is released automatically once this has passed, which is what stops abandoned checkouts using up a promotion.'),
  ('coupon_min_charge_minor', '100', 'int',
   'The least a discounted purchase may still cost, in pesewas. A coupon that would go below this is clamped to it rather than refused, because the payment provider cannot charge zero.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. What a coupon has been used for
-- ---------------------------------------------------------------------------

/**
 * Places taken: confirmed redemptions, plus checkouts young enough to still be
 * somebody standing at the Paystack page. Never a stored counter. See the
 * header for why.
 */
create or replace function public.coupon_uses(p_coupon_id uuid, p_user_id uuid default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.coupon_redemptions r
    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
    left join public.orders o on o.id = r.order_id
   where r.coupon_id = p_coupon_id
     and (p_user_id is null or r.user_id = p_user_id)
     and (
       coalesce(sp.status::text, o.status::text) = 'confirmed'
       or (
         coalesce(sp.status::text, o.status::text) = 'pending'
         and r.created_at > now() - make_interval(mins => public.config_int('coupon_hold_minutes')::int)
       )
     );
$$;

comment on function public.coupon_uses(uuid, uuid) is
  'Places taken in a coupon quota: confirmed redemptions plus unconfirmed ones still inside coupon_hold_minutes. Pass a user id for that person''s own count.';


-- ---------------------------------------------------------------------------
-- 3. The one implementation of the rules
-- ---------------------------------------------------------------------------
--
-- The checkout previews a code with this, and the two purchase paths apply it
-- with the same function. A separate preview would drift from the rule that
-- actually charges, and the drift shows up as a screen promising a price the
-- database refuses.
--
-- ⚠️ CALL IT AS `select * from coupon_quote(...)`, never `(coupon_quote(...)).*`
-- — the second form runs the whole function once per column.

create or replace function public.coupon_quote(
  p_user_id    uuid,
  p_code       text,
  p_tier_id    uuid,
  p_product_id uuid,
  p_amount_minor bigint,
  p_kind       public.order_kind default 'purchase'
)
returns table (
  coupon_id      uuid,
  ok             boolean,
  reason         text,
  list_minor     bigint,
  discount_minor bigint,
  charged_minor  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c        public.coupons;
  v_discount bigint;
  v_floor    bigint := public.config_int('coupon_min_charge_minor');
  v_owned    boolean;
begin
  list_minor     := greatest(coalesce(p_amount_minor, 0), 0);
  discount_minor := 0;
  charged_minor  := list_minor;
  ok             := false;

  if p_code is null or btrim(p_code) = '' then
    reason := 'no_code';
    return next;
    return;
  end if;

  select * into v_c from public.coupons c where upper(c.code) = upper(btrim(p_code));

  if not found then
    reason := 'unknown';       return next; return;
  end if;

  coupon_id := v_c.id;

  if not v_c.is_active then
    reason := 'inactive';      return next; return;
  end if;
  if v_c.starts_at is not null and now() < v_c.starts_at then
    reason := 'not_started';   return next; return;
  end if;
  if v_c.ends_at is not null and now() >= v_c.ends_at then
    reason := 'expired';       return next; return;
  end if;

  /* The target. A code for another plan is not an error the buyer caused, so
     it gets its own reason rather than "unknown": telling somebody their real
     code is unrecognised sends them to support. */
  if v_c.business = 'ads' then
    if p_tier_id is null or v_c.tier_id <> p_tier_id then
      reason := 'wrong_target'; return next; return;
    end if;
  else
    if p_product_id is null or v_c.product_id <> p_product_id then
      reason := 'wrong_target'; return next; return;
    end if;
  end if;

  if v_c.first_purchase_only then
    if p_kind <> 'purchase' then
      reason := 'first_purchase_only'; return next; return;
    end if;

    if v_c.business = 'ads' then
      select exists (
        select 1 from public.user_subscriptions s
         where s.user_id = p_user_id and s.tier_id = v_c.tier_id
           and (
             (s.status = 'active' and now() < s.current_period_end)
             or (s.status = 'grace' and s.grace_ends_at is not null and now() < s.grace_ends_at)
           )
      ) into v_owned;
    else
      select public.has_entitlement(p_user_id, v_c.product_id) into v_owned;
    end if;

    if coalesce(v_owned, false) then
      reason := 'first_purchase_only'; return next; return;
    end if;
  end if;

  if list_minor < v_c.min_spend_minor then
    reason := 'min_spend';     return next; return;
  end if;

  if public.coupon_uses(v_c.id, p_user_id) >= v_c.per_user_limit then
    reason := 'already_used';  return next; return;
  end if;

  if public.coupon_uses(v_c.id) >= v_c.quota then
    reason := 'exhausted';     return next; return;
  end if;

  if v_c.discount_kind = 'percent' then
    v_discount := floor(list_minor * v_c.percent / 100.0);
    if v_c.max_discount_minor is not null then
      v_discount := least(v_discount, v_c.max_discount_minor);
    end if;
  else
    v_discount := v_c.amount_minor;
  end if;

  /* Never past the floor under the charge, and never negative. */
  v_discount := greatest(least(v_discount, greatest(list_minor - v_floor, 0)), 0);

  if v_discount <= 0 then
    reason := 'nothing_off';   return next; return;
  end if;

  ok             := true;
  reason         := null;
  discount_minor := v_discount;
  charged_minor  := list_minor - v_discount;
  return next;
end;
$$;

revoke execute on function public.coupon_quote(uuid, text, uuid, uuid, bigint, public.order_kind)
  from public, anon, authenticated;
grant execute on function public.coupon_quote(uuid, text, uuid, uuid, bigint, public.order_kind)
  to service_role;

revoke execute on function public.coupon_uses(uuid, uuid) from public, anon, authenticated;
grant execute on function public.coupon_uses(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 4. The admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_coupons(p_admin_id uuid)
returns table (
  id uuid, code text, business public.coupon_business,
  target_name text, tier_id uuid, product_id uuid,
  discount_kind public.coupon_discount_kind, percent numeric, amount_minor bigint,
  max_discount_minor bigint, min_spend_minor bigint,
  quota int, used int, per_user_limit int, first_purchase_only boolean,
  starts_at timestamptz, ends_at timestamptz, is_active boolean,
  note text, created_at timestamptz,
  discount_given_minor bigint, revenue_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select c.id, c.code, c.business,
         coalesce(t.name, p.title) as target_name,
         c.tier_id, c.product_id,
         c.discount_kind, c.percent, c.amount_minor,
         c.max_discount_minor, c.min_spend_minor,
         c.quota, public.coupon_uses(c.id) as used, c.per_user_limit, c.first_purchase_only,
         c.starts_at, c.ends_at, c.is_active,
         c.note, c.created_at,
         /* What the promotion has cost and what it brought in, counting only
            money that actually completed. A quota figure alone cannot answer
            "was it worth running". */
         coalesce((select sum(r.discount_minor) from public.coupon_redemptions r
                    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
                    left join public.orders o on o.id = r.order_id
                   where r.coupon_id = c.id
                     and coalesce(sp.status::text, o.status::text) = 'confirmed'), 0)::bigint,
         coalesce((select sum(r.charged_minor) from public.coupon_redemptions r
                    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
                    left join public.orders o on o.id = r.order_id
                   where r.coupon_id = c.id
                     and coalesce(sp.status::text, o.status::text) = 'confirmed'), 0)::bigint
    from public.coupons c
    left join public.tiers t    on t.id = c.tier_id
    left join public.products p on p.id = c.product_id
   order by c.is_active desc, c.created_at desc;
end;
$$;


create or replace function public.admin_save_coupon(
  p_admin_id uuid,
  p_id uuid,
  p_code text,
  p_business public.coupon_business,
  p_tier_id uuid,
  p_product_id uuid,
  p_discount_kind public.coupon_discount_kind,
  p_percent numeric,
  p_amount_minor bigint,
  p_max_discount_minor bigint,
  p_min_spend_minor bigint,
  p_quota int,
  p_per_user_limit int,
  p_first_purchase_only boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_active boolean,
  p_note text
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.coupons;
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_program public.affiliate_programs;
  v_product public.products;
  v_worst   numeric;
  v_payout  numeric;
begin
  perform public.assert_admin(p_admin_id);

  if v_code = '' then
    raise exception 'A coupon needs a code' using errcode = 'check_violation';
  end if;

  /* The target, checked here so the operator reads a sentence rather than
     `coupons_targets_one_business`. The constraint stays as the backstop: this
     is the message, that is the guarantee. */
  if p_business = 'ads' and p_tier_id is null then
    raise exception 'An ads coupon has to name the plan it applies to'
      using errcode = 'check_violation';
  end if;
  if p_business = 'affiliate' and p_product_id is null then
    raise exception 'An affiliate coupon has to name the programme it applies to'
      using errcode = 'check_violation';
  end if;
  if (p_business = 'ads' and p_product_id is not null)
     or (p_business = 'affiliate' and p_tier_id is not null) then
    raise exception 'A coupon applies to one business, so it names one plan or one programme, never both'
      using errcode = 'check_violation';
  end if;

  /* ⚠️ THE GUARD THE COMMISSION RULE CREATED. An affiliate is paid on the
     full list price of a discounted sale (operator, 2026-08-11), so a deep
     enough discount pays out more than the sale brought in. Refused here, at
     creation, because a coupon that cannot be honoured must not reach a
     flyer. */
  if p_business = 'affiliate' and p_product_id is not null then
    select * into v_program from public.affiliate_programs where product_id = p_product_id and status = 'active';
    if found then
      select * into v_product from public.products where id = p_product_id;
      v_payout := coalesce(v_program.l1_rate_value, 0) + coalesce(v_program.l2_rate_value, 0);

      v_worst := case
                   when p_discount_kind = 'percent' then p_percent
                   when coalesce(v_product.price_minor, 0) > 0
                     then 100.0 * p_amount_minor / v_product.price_minor
                   else 0
                 end;

      if v_worst > 100 - v_payout then
        /* Spelled out rather than punctuated: `%%%` in a raise format reads as
           a literal percent followed by an argument, which printed "%25.000"
           and made the sentence say the opposite of the number. */
        raise exception
          'That discount would pay out more commission than the sale brings in. % pays % percent across both levels, so the most this code may take off is % percent.',
          v_product.title, trim_scale(v_payout), trim_scale(100 - v_payout)
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if p_id is null then
    insert into public.coupons (
      code, business, tier_id, product_id, discount_kind, percent, amount_minor,
      max_discount_minor, min_spend_minor, quota, per_user_limit, first_purchase_only,
      starts_at, ends_at, is_active, note, created_by
    ) values (
      v_code, p_business, p_tier_id, p_product_id, p_discount_kind, p_percent, p_amount_minor,
      p_max_discount_minor, coalesce(p_min_spend_minor, 0), p_quota,
      coalesce(p_per_user_limit, 1), coalesce(p_first_purchase_only, true),
      p_starts_at, p_ends_at, coalesce(p_is_active, true), nullif(btrim(coalesce(p_note, '')), ''),
      p_admin_id
    )
    returning * into v_row;
  else
    /* The code itself is editable only while nobody has used it. Changing a
       code somebody is holding turns their code into "not recognised" with no
       way for support to see why. */
    if exists (select 1 from public.coupon_redemptions r where r.coupon_id = p_id)
       and exists (select 1 from public.coupons c where c.id = p_id and upper(c.code) <> v_code) then
      raise exception 'That code has already been used and cannot be renamed'
        using errcode = 'check_violation';
    end if;

    update public.coupons set
      code = v_code, business = p_business, tier_id = p_tier_id, product_id = p_product_id,
      discount_kind = p_discount_kind, percent = p_percent, amount_minor = p_amount_minor,
      max_discount_minor = p_max_discount_minor, min_spend_minor = coalesce(p_min_spend_minor, 0),
      quota = p_quota, per_user_limit = coalesce(p_per_user_limit, 1),
      first_purchase_only = coalesce(p_first_purchase_only, true),
      starts_at = p_starts_at, ends_at = p_ends_at, is_active = coalesce(p_is_active, true),
      note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_id
    returning * into v_row;

    if not found then
      raise exception 'Unknown coupon' using errcode = 'check_violation';
    end if;
  end if;

  return v_row;
end;
$$;


/**
 * Redemptions of one code, for the panel behind a row.
 *
 * A coupon is deleted rather than archived only while unused; once somebody
 * has redeemed it, `is_active` is the off switch, because the redemption rows
 * are a money record and the cascade would take them with it.
 */
create or replace function public.admin_list_coupon_redemptions(p_admin_id uuid, p_coupon_id uuid)
returns table (
  id uuid, user_id uuid, person text, email text,
  list_minor bigint, discount_minor bigint, charged_minor bigint,
  status text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select r.id, r.user_id, pr.full_name, u.email::text,
         r.list_minor, r.discount_minor, r.charged_minor,
         coalesce(sp.status::text, o.status::text) as status,
         r.created_at
    from public.coupon_redemptions r
    join auth.users u on u.id = r.user_id
    left join public.profiles pr on pr.id = r.user_id
    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
    left join public.orders o on o.id = r.order_id
   where r.coupon_id = p_coupon_id
   order by r.created_at desc;
end;
$$;


create or replace function public.admin_delete_coupon(p_admin_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin_id);

  if exists (select 1 from public.coupon_redemptions r where r.coupon_id = p_id) then
    raise exception 'That code has been used, so it can be switched off but not deleted'
      using errcode = 'check_violation';
  end if;

  delete from public.coupons where id = p_id;
end;
$$;


/* ⚠️ Every function above is new, and `create function` grants EXECUTE to
   PUBLIC. Migrations 103 and 104 exist because seventeen functions were
   answering the publishable key, several of them taking a user id and never
   asking who was calling. These take an admin id and check it, but the anon
   key must not reach them regardless. */
revoke execute on function public.admin_list_coupons(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_coupon(uuid, uuid, text, public.coupon_business, uuid, uuid,
  public.coupon_discount_kind, numeric, bigint, bigint, bigint, int, int, boolean,
  timestamptz, timestamptz, boolean, text) from public, anon, authenticated;
revoke execute on function public.admin_list_coupon_redemptions(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_delete_coupon(uuid, uuid) from public, anon, authenticated;

grant execute on function public.admin_list_coupons(uuid) to service_role;
grant execute on function public.admin_save_coupon(uuid, uuid, text, public.coupon_business, uuid, uuid,
  public.coupon_discount_kind, numeric, bigint, bigint, bigint, int, int, boolean,
  timestamptz, timestamptz, boolean, text) to service_role;
grant execute on function public.admin_list_coupon_redemptions(uuid, uuid) to service_role;
grant execute on function public.admin_delete_coupon(uuid, uuid) to service_role;
