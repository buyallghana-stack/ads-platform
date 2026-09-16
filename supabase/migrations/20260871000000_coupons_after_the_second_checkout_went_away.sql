-- ============================================================================
-- Migration 223 — coupons work again, with one checkout instead of two
--
-- 20260827000000 taught coupons to reach BOTH checkouts: a plan on the ads
-- side, a training programme or product on the affiliate side. 20260865000000
-- then dropped `products`, `orders` and `affiliate_programs`, and took four
-- coupon functions with them:
--
--   coupon_uses                   -> joins public.orders
--   admin_list_coupon_redemptions -> joins public.orders
--   admin_list_coupons            -> joins public.orders and public.products
--   admin_save_coupon             -> DECLARES a public.affiliate_programs and
--                                    a public.products row variable, so it
--                                    raised before it ran a single statement
--
-- The last one is why the coupon suite was entirely red: every test creates a
-- code, and creating one reported `type "public.affiliate_programs" does not
-- exist`. The money path itself, `coupon_quote` and `take_coupon`, was never
-- broken, which is the one piece of luck in this.
--
-- WHAT IS KEPT. The `business` column, the `product_id` column and every
-- argument name stay exactly as they were. Nothing is renamed and no argument
-- is removed, because PostgREST picks an overload by argument NAMES and the
-- admin screens call these by name. The affiliate arm is refused at the door
-- rather than deleted, so an operator who tries gets a sentence instead of a
-- constraint error, and the column is still there if that business ever comes
-- back.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- How many times a code has really been used.
--
-- One checkout now, so one join. A redemption is counted when its payment
-- confirmed, or while it is pending inside the hold window, which is what
-- gives a place back when somebody abandons a checkout.
-- ----------------------------------------------------------------------------
create or replace function public.coupon_uses(p_coupon_id uuid, p_user_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::int
    from public.coupon_redemptions r
    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
   where r.coupon_id = p_coupon_id
     and (p_user_id is null or r.user_id = p_user_id)
     and (
       sp.status::text = 'confirmed'
       or (
         sp.status::text = 'pending'
         and r.created_at > now() - make_interval(mins => public.config_int('coupon_hold_minutes')::int)
       )
     );
$function$;

revoke execute on function public.coupon_uses(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.coupon_uses(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
create or replace function public.admin_list_coupon_redemptions(p_admin_id uuid, p_coupon_id uuid)
returns table(
  id uuid, user_id uuid, person text, email text,
  list_minor bigint, discount_minor bigint, charged_minor bigint,
  status text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select r.id, r.user_id, pr.full_name, u.email::text,
         r.list_minor, r.discount_minor, r.charged_minor,
         sp.status::text as status,
         r.created_at
    from public.coupon_redemptions r
    join auth.users u on u.id = r.user_id
    left join public.profiles pr on pr.id = r.user_id
    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
   where r.coupon_id = p_coupon_id
   order by r.created_at desc;
end;
$function$;

revoke execute on function public.admin_list_coupon_redemptions(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_list_coupon_redemptions(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
create or replace function public.admin_list_coupons(p_admin_id uuid)
returns table(
  id uuid, code text, business public.coupon_business, target_name text,
  tier_id uuid, product_id uuid,
  discount_kind public.coupon_discount_kind, percent numeric, amount_minor bigint,
  max_discount_minor bigint, min_spend_minor bigint, quota integer, used integer,
  per_user_limit integer, first_purchase_only boolean,
  starts_at timestamptz, ends_at timestamptz, is_active boolean,
  note text, created_at timestamptz,
  discount_given_minor bigint, revenue_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform public.assert_admin(p_admin_id);

  return query
  select c.id, c.code, c.business,
         t.name as target_name,
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
                   where r.coupon_id = c.id and sp.status::text = 'confirmed'), 0)::bigint,
         coalesce((select sum(r.charged_minor) from public.coupon_redemptions r
                    left join public.subscription_payments sp on sp.id = r.subscription_payment_id
                   where r.coupon_id = c.id and sp.status::text = 'confirmed'), 0)::bigint
    from public.coupons c
    left join public.tiers t on t.id = c.tier_id
   order by c.is_active desc, c.created_at desc;
end;
$function$;

revoke execute on function public.admin_list_coupons(uuid) from public, anon, authenticated;
grant  execute on function public.admin_list_coupons(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Creating and editing a code.
--
-- The commission guard is gone with the business it protected. It refused a
-- discount deep enough that paying an affiliate on the full list price would
-- cost more than the sale brought in. There is no affiliate and no list price
-- to pay on, so there is nothing left to protect, and the two row variables it
-- needed were what made this function unusable.
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_coupon(
  p_admin_id uuid, p_id uuid, p_code text, p_business public.coupon_business,
  p_tier_id uuid, p_product_id uuid,
  p_discount_kind public.coupon_discount_kind, p_percent numeric, p_amount_minor bigint,
  p_max_discount_minor bigint, p_min_spend_minor bigint, p_quota integer,
  p_per_user_limit integer, p_first_purchase_only boolean,
  p_starts_at timestamptz, p_ends_at timestamptz, p_is_active boolean, p_note text
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row  public.coupons;
  v_code text := upper(btrim(coalesce(p_code, '')));
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

  /* Refused rather than quietly accepted. There is nothing left for an
     affiliate coupon to discount, so one saved today would be a code that
     looks live in the admin and is not recognised at any till. */
  if p_business = 'affiliate' then
    raise exception 'Affiliate coupons cannot be created: that catalogue no longer exists. Name a plan instead.'
      using errcode = 'check_violation';
  end if;

  if p_product_id is not null then
    raise exception 'A coupon applies to one business, so it names one plan, never a product'
      using errcode = 'check_violation';
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
$function$;

revoke execute on function public.admin_save_coupon(
  uuid, uuid, text, public.coupon_business, uuid, uuid, public.coupon_discount_kind,
  numeric, bigint, bigint, bigint, integer, integer, boolean,
  timestamptz, timestamptz, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_save_coupon(
  uuid, uuid, text, public.coupon_business, uuid, uuid, public.coupon_discount_kind,
  numeric, bigint, bigint, bigint, integer, integer, boolean,
  timestamptz, timestamptz, boolean, text) to service_role;
