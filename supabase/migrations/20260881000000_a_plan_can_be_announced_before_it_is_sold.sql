-- ============================================================================
-- Migration 233 - a plan can be announced before it is sold
--
-- WHY. The operator wants plans above Gold shown but not buyable yet: the
-- ladder reads as complete, the top rungs read as coming, and nobody is
-- charged for one. Sapphire and Platinum are the two today.
--
-- ⚠️ THIS IS NOT `is_active`, AND IT MUST NOT BECOME IT. A hidden plan is out
-- of the ladder entirely. A coming soon plan is IN it and must stay in it,
-- because every band is cut against the next rung up: Gold's ceiling and the
-- rate it interpolates towards are Sapphire's price and Sapphire's multiplier.
-- Take Sapphire out of the list and Gold silently starts selling a different
-- band at a different rate. So this is a third state, not a second way to
-- hide, and nothing may filter these rows out of a ladder computation.
--
--   is_active = false   not shown, not sold, not in the ladder
--   coming_soon = true  shown, NOT sold, still in the ladder
--   neither             on sale
--
-- Three things change here:
--   1. the column, and the two plans that get it today
--   2. `start_subscription_payment` refuses one, because a locked button is a
--      picture of a rule and this is the rule
--   3. the admin can set it: `admin_save_plan` carries it and
--      `admin_set_plan_coming_soon` toggles it from the plans table
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.tiers
  add column if not exists coming_soon boolean not null default false;

comment on column public.tiers.coming_soon is
  'Shown on the upgrade screen with a locked button, and refused by '
  'start_subscription_payment. NOT the same as is_active: a coming soon plan '
  'stays in the ladder, because the bands of the plan below are cut against '
  'it.';

-- The starting plan is never coming soon: everybody is already on it.
alter table public.tiers
  drop constraint if exists tiers_default_is_never_coming_soon;

alter table public.tiers
  add constraint tiers_default_is_never_coming_soon
  check (not (is_default and coming_soon));

-- ---------------------------------------------------------------------------
-- 2. Everything dearer than Gold, today
-- ---------------------------------------------------------------------------
--
-- Read from Gold's PRICE rather than from a list of slugs, so it says what the
-- operator asked for ("everything more expensive than Gold") rather than a
-- snapshot of which plans happened to exist on 18 September 2026. It is still
-- a one-off: from here the admin screen owns this flag, and re-running this
-- migration against a ladder the operator has since retuned would only set the
-- same rule again, never unset a decision they made.

do $$
declare
  v_gold bigint;
  v_n    integer;
begin
  select price_minor into v_gold from public.tiers where slug = 'gold';

  if v_gold is null then
    raise notice 'No plan with slug gold, so nothing was marked coming soon.';
    return;
  end if;

  update public.tiers
     set coming_soon = true, updated_at = now()
   where price_minor > v_gold
     and not is_default
     and not coming_soon;

  get diagnostics v_n = row_count;
  raise notice 'Marked % plan(s) dearer than Gold as coming soon.', v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The checkout refuses one
-- ---------------------------------------------------------------------------
--
-- ⚠️ The body below is the LIVE definition read out of production on
-- 18 September 2026, with the one guard added. It is not retyped: this
-- function takes an enum argument, and a signature rewritten from memory is
-- accepted by `create or replace` as a SECOND overload while the real one goes
-- on running unchanged. That has happened on this project before.

CREATE OR REPLACE FUNCTION public.start_subscription_payment(p_user_id uuid, p_tier_id uuid, p_method subscription_payment_method, p_amount_minor bigint DEFAULT NULL::bigint, p_coupon_code text DEFAULT NULL::text)
 RETURNS subscription_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tier   public.tiers;
  v_row    public.subscription_payments;
  v_prof   public.profiles;
  v_max    bigint;
  v_amount bigint;
  v_take   record;
  v_charge bigint;
  /* Separate from the record on purpose: reading a field of a record that was
     never assigned raises, so "was a coupon used" cannot be asked of `v_take`
     itself on the no-coupon path. */
  v_coupon   uuid;
  v_discount bigint := 0;
begin
  select * into v_prof from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'check_violation';
  end if;
  if v_prof.disabled_at is not null then
    raise exception 'This account is disabled' using errcode = 'check_violation';
  end if;

  select * into v_tier from public.tiers where id = p_tier_id;
  if not found or not v_tier.is_active then
    raise exception 'That tier is not available' using errcode = 'check_violation';
  end if;

  /* ⚠️ COMING SOON IS A REFUSAL, NOT A STYLE.

     A plan marked coming soon is SHOWN on the upgrade screen, in its place in
     the ladder, with everything it will give. The card's button is locked, and
     a locked button is worth nothing on its own: this action is reachable by
     anyone who can post a tier id. The money path is where "not yet" has to
     be true, and this is the money path. */
  if v_tier.coming_soon then
    raise exception '% is not on sale yet', v_tier.name using errcode = 'check_violation';
  end if;

  if v_tier.is_default or v_tier.price_minor = 0 then
    raise exception 'The % tier is free and does not need a subscription', v_tier.name
      using errcode = 'check_violation';
  end if;

  /*
    Null means "the plain price", which keeps every existing caller working
    and makes the floor the default rather than something a client has to
    know.
  */
  v_amount := coalesce(p_amount_minor, v_tier.price_minor);
  v_max    := public.plan_band_max_minor(p_tier_id);

  /* ⚠️ THE BAND IS CHECKED AGAINST THE CHOSEN AMOUNT, BEFORE ANY DISCOUNT.
     Checking the discounted figure would make a coupon a way to buy a plan
     below its own floor, which is exactly the thing bands exist to prevent. */
  if v_amount < v_tier.price_minor then
    raise exception 'The least you can pay for % is %', v_tier.name,
      to_char(v_tier.price_minor / 100.0, 'FM999999990.00')
      using errcode = 'check_violation';
  end if;

  if v_amount > v_max then
    raise exception 'The most you can pay for % is %', v_tier.name,
      to_char(v_max / 100.0, 'FM999999990.00')
      using errcode = 'check_violation';
  end if;

  /* Whole pesewas only. A fractional minor unit is not money, and Paystack
     would reject it after the user had already been sent to pay. */
  if v_amount <> floor(v_amount) then
    raise exception 'That amount is not a whole number of pesewas' using errcode = 'check_violation';
  end if;

  v_charge := v_amount;

  if nullif(btrim(coalesce(p_coupon_code, '')), '') is not null then
    select * into v_take
      from public.take_coupon(p_user_id, p_coupon_code, p_tier_id, null, v_amount, 'purchase');
    v_charge   := v_take.charged_minor;
    v_coupon   := v_take.coupon_id;
    v_discount := v_take.discount_minor;
  end if;

  insert into public.subscription_payments (
    user_id, tier_id, method, amount_minor, list_minor, currency_code, period_days
  )
  values (
    p_user_id, p_tier_id, p_method, v_charge,
    /* Only when they differ. A list price equal to the charge is noise in
       every report that reads this table. */
    case when v_charge <> v_amount then v_amount else null end,
    v_tier.currency_code, v_tier.billing_period_days
  )
  returning * into v_row;

  if v_coupon is not null then
    insert into public.coupon_redemptions
      (coupon_id, user_id, subscription_payment_id, list_minor, discount_minor, charged_minor)
    values
      (v_coupon, p_user_id, v_row.id, v_amount, v_discount, v_charge);
  end if;

  return v_row;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 4. The admin owns the flag
-- ---------------------------------------------------------------------------
--
-- `admin_save_plan` follows the same shape the band ceilings use: the key is
-- honoured when PRESENT, so the editor can set or clear it and a caller that
-- says nothing about it leaves it alone.

create or replace function public.admin_set_plan_coming_soon(
  p_admin_id    uuid,
  p_plan_id     uuid,
  p_coming_soon boolean
)
returns public.tiers
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.tiers;
begin
  perform public.assert_admin(p_admin_id);

  if p_coming_soon and exists (
    select 1 from public.tiers t where t.id = p_plan_id and t.is_default
  ) then
    raise exception 'The starting plan cannot be coming soon, everybody is already on it'
      using errcode = 'check_violation';
  end if;

  /* Deliberately silent about existing holders. Marking a plan coming soon
     stops NEW purchases and does nothing to a subscription somebody already
     paid for: resolve_user_tier reads the tier row, not this flag, so what
     they bought keeps working until it expires. Saying so here because the
     obvious fear on reading this function is the opposite. */
  update public.tiers set coming_soon = p_coming_soon, updated_at = now()
   where id = p_plan_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown plan' using errcode = 'check_violation';
  end if;

  return v_out;
end;
$$;

revoke execute on function public.admin_set_plan_coming_soon(uuid, uuid, boolean)
  from public, anon, authenticated;
grant  execute on function public.admin_set_plan_coming_soon(uuid, uuid, boolean)
  to service_role;

-- The editor's own save carries it too, so creating a plan already announced
-- does not need a second round trip to mark it. Live definition, one key added
-- in three places: the insert's columns, its values, and the update.

CREATE OR REPLACE FUNCTION public.admin_save_plan(p_admin_id uuid, p_plan jsonb)
 RETURNS tiers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id   uuid := nullif(p_plan ->> 'id', '')::uuid;
  v_slug text := lower(trim(coalesce(p_plan ->> 'slug', '')));
  v_out  public.tiers;
  v_existing public.tiers;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    if v_slug !~ '^[a-z][a-z0-9_-]*$' then
      raise exception 'A plan needs a short name in lowercase letters, like "gold"'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.tiers t where t.slug = v_slug) then
      raise exception 'There is already a plan called %', v_slug using errcode = 'check_violation';
    end if;

    insert into public.tiers (
      slug, name, description, price_minor, billing_period_days, daily_ad_cap,
      reward_multiplier, redemption_minimum_points, referral_bonus_multiplier,
      ad_priority, ad_cooldown_seconds, is_active, coming_soon, sort_order,
      band_max_minor, band_max_multiplier
    ) values (
      v_slug,
      trim(coalesce(p_plan ->> 'name', '')),
      nullif(trim(coalesce(p_plan ->> 'description', '')), ''),
      round((p_plan ->> 'priceGhs')::numeric * 100),
      coalesce((p_plan ->> 'billingPeriodDays')::int, 30),
      coalesce((p_plan ->> 'dailyAdCap')::int, 0),
      coalesce((p_plan ->> 'rewardMultiplier')::numeric, 1),
      coalesce((p_plan ->> 'redemptionMinimumPoints')::bigint, 0),
      coalesce((p_plan ->> 'referralBonusMultiplier')::numeric, 1),
      coalesce((p_plan ->> 'adPriority')::int, 0),
      coalesce((p_plan ->> 'adCooldownSeconds')::int, 0),
      coalesce((p_plan ->> 'isActive')::boolean, true),
      coalesce((p_plan ->> 'comingSoon')::boolean, false),
      -- `nullif(..., 0)` and not a plain coalesce: the editor sends 0 for a
      -- plan it has no position for yet, and taking that literally puts a new
      -- paid plan level with the free tier at the top of the ladder. An
      -- explicit 0 is only meaningful for the starting plan, which already
      -- exists and is never created here.
      coalesce(nullif((p_plan ->> 'sortOrder')::int, 0),
               (select coalesce(max(t.sort_order), 0) + 1 from public.tiers t)),
      round(nullif(p_plan ->> 'bandMaxGhs', '')::numeric * 100),
      nullif(p_plan ->> 'bandMaxMultiplier', '')::numeric
    )
    returning * into v_out;

    return v_out;
  end if;

  select * into v_existing from public.tiers where id = v_id;
  if not found then
    raise exception 'Unknown plan' using errcode = 'check_violation';
  end if;

  if v_slug <> '' and v_slug <> v_existing.slug then
    raise exception 'A plan''s short name cannot be changed once it exists'
      using errcode = 'check_violation';
  end if;

  -- The default tier must stay free. The table constraint says so too; this
  -- says it in a sentence, before the constraint says it in a stack trace.
  if v_existing.is_default and round((p_plan ->> 'priceGhs')::numeric * 100) <> 0 then
    raise exception 'The starting plan must stay free — everybody is on it without paying'
      using errcode = 'check_violation';
  end if;

  update public.tiers set
    name                      = trim(coalesce(p_plan ->> 'name', name)),
    description               = nullif(trim(coalesce(p_plan ->> 'description', '')), ''),
    price_minor               = round(coalesce((p_plan ->> 'priceGhs')::numeric * 100, price_minor)),
    billing_period_days       = coalesce((p_plan ->> 'billingPeriodDays')::int, billing_period_days),
    daily_ad_cap              = coalesce((p_plan ->> 'dailyAdCap')::int, daily_ad_cap),
    reward_multiplier         = coalesce((p_plan ->> 'rewardMultiplier')::numeric, reward_multiplier),
    redemption_minimum_points = coalesce((p_plan ->> 'redemptionMinimumPoints')::bigint, redemption_minimum_points),
    referral_bonus_multiplier = coalesce((p_plan ->> 'referralBonusMultiplier')::numeric, referral_bonus_multiplier),
    ad_priority               = coalesce((p_plan ->> 'adPriority')::int, ad_priority),
    ad_cooldown_seconds       = coalesce((p_plan ->> 'adCooldownSeconds')::int, ad_cooldown_seconds),
    sort_order                = coalesce((p_plan ->> 'sortOrder')::int, sort_order),
    /* Present means set it, absent means leave it, the same rule the band
       ceilings use. A save that did not mention the flag must not quietly put
       a plan back on sale. */
    coming_soon               = case when p_plan ? 'comingSoon'
                                     then coalesce((p_plan ->> 'comingSoon')::boolean, false)
                                     else coming_soon end,
    band_max_minor            = case when p_plan ? 'bandMaxGhs'
                                     then round(nullif(p_plan ->> 'bandMaxGhs', '')::numeric * 100)
                                     else band_max_minor end,
    band_max_multiplier       = case when p_plan ? 'bandMaxMultiplier'
                                     then nullif(p_plan ->> 'bandMaxMultiplier', '')::numeric
                                     else band_max_multiplier end,
    updated_at                = now()
  where id = v_id
  returning * into v_out;

  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The admin listing carries it
-- ---------------------------------------------------------------------------
--
-- ⚠️ DROP AND CREATE, not `create or replace`: a function's OUT columns cannot
-- change in place. Dropping hands EXECUTE back to PUBLIC, so the grants at the
-- bottom are not a formality. That is how seventeen functions once became
-- readable with the anon key.

drop function if exists public.admin_list_plans();

create function public.admin_list_plans()
 RETURNS TABLE(id uuid, slug text, name text, description text, price_ghs numeric, band_max_ghs numeric, own_band_max_ghs numeric, own_band_max_multiplier numeric, billing_period_days integer, daily_ad_cap integer, reward_multiplier numeric, redemption_minimum_points bigint, referral_bonus_multiplier numeric, ad_priority integer, ad_cooldown_seconds integer, is_default boolean, is_active boolean, coming_soon boolean, sort_order integer, active integer, active_last_month integer, monthly_ghs numeric, paid_count integer, paid_above_floor integer, paid_avg_ghs numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_then timestamptz := now() - interval '30 days';
begin
  /* Added by migration 103. The check below cannot fire for a signed-out
     caller, whose auth.uid() is null — which was precisely the caller who
     could read this whole table with the publishable key. */
  perform public.assert_not_anonymous();

  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    t.id,
    t.slug,
    t.name,
    coalesce(t.description, ''),
    t.price_minor::numeric / 100,

    -- The ceiling, from the function the payment path itself validates
    -- against. Null where there is no band to speak of: the free plan is not
    -- sold, and a hidden plan is not in the ladder that the bands are cut
    -- from, so it has no neighbour to end against.
    case
      when t.is_default or not t.is_active then null
      else public.plan_band_max_minor(t.id)::numeric / 100
    end,

    /* The plan's OWN stored ceiling, which is a different question from the
       one above: that one is derived and every sold plan has an answer, these
       are set by hand and only the top rung has them. The editor needs the
       STORED values to fill its fields — offering to save a derived number
       would give a plan a ceiling it never had, and pin the middle of the
       ladder to a figure the database ignores. */
    t.band_max_minor::numeric / 100,
    t.band_max_multiplier,

    t.billing_period_days,
    t.daily_ad_cap,
    t.reward_multiplier,
    t.redemption_minimum_points,
    t.referral_bonus_multiplier,
    t.ad_priority,
    t.ad_cooldown_seconds,
    t.is_default,
    t.is_active,
    t.coming_soon,
    t.sort_order,

    case when t.is_default then
      -- Everyone who holds no live paid plan. Deleted accounts excluded so it
      -- matches the user count on the overview.
      (select count(*)::int from public.profiles p
        where p.deleted_at is null
          and not exists (
            select 1 from public.user_subscriptions s
             where s.user_id = p.id and s.status in ('active', 'grace')))
    else
      (select count(*)::int from public.user_subscriptions s
        where s.tier_id = t.id and s.status in ('active', 'grace'))
    end,

    case when t.is_default then
      (select count(*)::int from public.profiles p
        where p.deleted_at is null
          and p.created_at <= v_then
          and not exists (
            select 1 from public.user_subscriptions s
             where s.user_id = p.id
               and s.started_at <= v_then
               and (s.cancelled_at is null or s.cancelled_at > v_then)
               and s.current_period_end > v_then))
    else
      (select count(*)::int from public.user_subscriptions s
        where s.tier_id = t.id
          and s.started_at <= v_then
          and (s.cancelled_at is null or s.cancelled_at > v_then)
          and s.current_period_end > v_then)
    end,

    -- What this plan actually brought in over the last thirty days. Confirmed
    -- payments only: a pending row that never cleared is not revenue.
    coalesce((select sum(sp.amount_minor)::numeric / 100
                from public.subscription_payments sp
               where sp.tier_id = t.id
                 and sp.status = 'confirmed'
                 and sp.confirmed_at >= v_then), 0),

    /* ---- What buyers chose inside the band ---------------------------
       One pass over the same confirmed payments. Strictly ABOVE the floor,
       not at or above it: everybody who takes the default is at the floor,
       and counting them would make every plan look like a success. */
    coalesce((select count(*)::int from public.subscription_payments sp
               where sp.tier_id = t.id
                 and sp.status = 'confirmed'
                 and sp.confirmed_at >= v_then), 0),

    coalesce((select count(*)::int from public.subscription_payments sp
               where sp.tier_id = t.id
                 and sp.status = 'confirmed'
                 and sp.confirmed_at >= v_then
                 and sp.amount_minor > t.price_minor), 0),

    -- Null rather than zero when nobody has bought: "no average" and "they
    -- paid nothing" are different things, and a zero would be graphed.
    (select round(avg(sp.amount_minor)::numeric / 100, 2)
       from public.subscription_payments sp
      where sp.tier_id = t.id
        and sp.status = 'confirmed'
        and sp.confirmed_at >= v_then)

  from public.tiers t
  order by t.sort_order, t.price_minor;
end;
$function$;


revoke execute on function public.admin_list_plans() from public, anon;
grant  execute on function public.admin_list_plans() to authenticated, service_role;
