-- ============================================================================
-- Migration 058 — the plan editor, and what each plan is actually selling
--
-- The Subscriptions screen has had a complete editor since it was designed —
-- create, edit, duplicate, hide, and the value-per-cedi warning migration 037
-- asked for — all of it against `preview.plans()`. This gives it a database.
--
-- EDITING A TIER IS A MONEY OPERATION, which is why the guards below are not
-- ceremony. `resolve_user_tier` reads these rows live, so changing a plan's
-- `reward_multiplier` changes what every current holder earns on their next
-- ad, and changing `redemption_minimum_points` changes what they must reach
-- before they can withdraw. Nothing here is retroactive — the ledger keeps its
-- own rate and past subscriptions keep what they paid — but everything here is
-- immediate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. admin_list_plans
-- ---------------------------------------------------------------------------
--
-- WHY THE FREE TIER'S "ACTIVE" IS COUNTED DIFFERENTLY
-- Nobody subscribes to Free — it is the default, and holding no paid plan is
-- what puts you on it, so `user_subscriptions` has no rows for it and a plain
-- count would report zero. The honest number is everyone who holds no paid
-- plan at all, which is also the denominator the screen exists to show: 2,400
-- on Free against 400 paying is the conversion rate, and reporting Free as 0
-- would make the paid figures look like the whole platform.
--
-- `active_last_month` is a POINT-IN-TIME count, not "how many joined": a plan
-- is counted if it had started, had not been cancelled, and had not expired as
-- at thirty days ago. That is the only way the arrow next to it means growth
-- rather than churn.

drop function if exists public.admin_list_plans();

create function public.admin_list_plans()
returns table (
  id                         uuid,
  slug                       text,
  name                       text,
  description                text,
  price_ghs                  numeric,
  billing_period_days        int,
  daily_ad_cap               int,
  reward_multiplier          numeric,
  redemption_minimum_points  bigint,
  referral_bonus_multiplier  numeric,
  ad_priority                int,
  ad_cooldown_seconds        int,
  is_default                 boolean,
  is_active                  boolean,
  sort_order                 int,
  active                     int,
  active_last_month          int,
  monthly_ghs                numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_then timestamptz := now() - interval '30 days';
begin
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
    t.billing_period_days,
    t.daily_ad_cap,
    t.reward_multiplier,
    t.redemption_minimum_points,
    t.referral_bonus_multiplier,
    t.ad_priority,
    t.ad_cooldown_seconds,
    t.is_default,
    t.is_active,
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
                 and sp.confirmed_at >= v_then), 0)

  from public.tiers t
  order by t.sort_order, t.price_minor;
end;
$$;

comment on function public.admin_list_plans() is
  'Plans with what each is selling. The default tier''s "active" is everyone holding no paid plan, because nobody subscribes to free and a plain count would report zero.';

revoke execute on function public.admin_list_plans() from public, anon;
grant execute on function public.admin_list_plans() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. admin_save_plan
-- ---------------------------------------------------------------------------
--
-- THE SLUG IS IMMUTABLE ONCE THE PLAN EXISTS. `subscription_payments`,
-- `user_subscriptions` and the seed all identify a plan by id, but the slug is
-- what appears in operator conversation, in support threads and in the seed
-- script — renaming it silently makes every one of those references wrong
-- about a plan that still exists. The editor already locks the field; this
-- refuses it on the server, because a locked field is a UI convention and not
-- a guarantee.
--
-- The value-per-cedi rule from migration 037 is NOT enforced here, on purpose.
-- It is a warning on the editor, and the operator is entitled to overrule a
-- warning they understand — a promotional plan is a legitimate thing to want.
-- What the database enforces is the set of things that would corrupt data
-- rather than merely be unwise: the constraints already on the table.

create or replace function public.admin_save_plan(p_admin_id uuid, p_plan jsonb)
returns public.tiers
language plpgsql
security definer
set search_path = ''
as $$
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
      ad_priority, ad_cooldown_seconds, is_active, sort_order
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
      -- `nullif(..., 0)` and not a plain coalesce: the editor sends 0 for a
      -- plan it has no position for yet, and taking that literally puts a new
      -- paid plan level with the free tier at the top of the ladder. An
      -- explicit 0 is only meaningful for the starting plan, which already
      -- exists and is never created here.
      coalesce(nullif((p_plan ->> 'sortOrder')::int, 0),
               (select coalesce(max(t.sort_order), 0) + 1 from public.tiers t))
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
    updated_at                = now()
  where id = v_id
  returning * into v_out;

  return v_out;
end;
$$;

revoke execute on function public.admin_save_plan(uuid, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Hiding, and deleting
-- ---------------------------------------------------------------------------
--
-- HIDING IS NOT CANCELLING. `is_active = false` takes a plan off the upgrade
-- screen so nobody new can buy it; everyone already holding it keeps every
-- benefit until their period ends, because `resolve_user_tier` reads the
-- subscription, not the shop window. That is the honest behaviour — somebody
-- who paid for ninety days of Gold last week did not agree to lose it because
-- the plan was withdrawn from sale — and it is what makes hiding safe enough
-- to offer without a confirmation.

create or replace function public.admin_set_plan_visibility(
  p_admin_id uuid,
  p_plan_id  uuid,
  p_active   boolean
)
returns public.tiers
language plpgsql
security definer
set search_path = ''
as $$
declare v_out public.tiers;
begin
  perform public.assert_admin(p_admin_id);

  if not p_active and exists (
    select 1 from public.tiers t where t.id = p_plan_id and t.is_default
  ) then
    raise exception 'The starting plan cannot be hidden — every new account lands on it'
      using errcode = 'check_violation';
  end if;

  update public.tiers set is_active = p_active, updated_at = now()
   where id = p_plan_id
  returning * into v_out;

  if not found then
    raise exception 'Unknown plan' using errcode = 'check_violation';
  end if;

  return v_out;
end;
$$;

revoke execute on function public.admin_set_plan_visibility(uuid, uuid, boolean)
  from public, anon, authenticated;


-- Delete only while nothing has ever pointed at it; otherwise hide.
--
-- `user_subscriptions.tier_id` and `subscription_payments.tier_id` are both ON
-- DELETE RESTRICT, so the database would refuse anyway — but it would refuse
-- with a foreign-key violation, which tells an operator nothing. This checks
-- first and says what it is doing, the same shape as `admin_delete_ad` and
-- `admin_delete_advertiser`.

create or replace function public.admin_delete_plan(p_admin_id uuid, p_plan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_in_use int;
begin
  perform public.assert_admin(p_admin_id);

  if exists (select 1 from public.tiers t where t.id = p_plan_id and t.is_default) then
    raise exception 'The starting plan cannot be deleted' using errcode = 'check_violation';
  end if;

  select
    (select count(*) from public.user_subscriptions s where s.tier_id = p_plan_id)
    + (select count(*) from public.subscription_payments p where p.tier_id = p_plan_id)
  into v_in_use;

  if v_in_use > 0 then
    update public.tiers set is_active = false, updated_at = now() where id = p_plan_id;
    if not found then
      raise exception 'Unknown plan' using errcode = 'check_violation';
    end if;
    return 'hidden';
  end if;

  delete from public.tiers where id = p_plan_id;
  if not found then
    raise exception 'Unknown plan' using errcode = 'check_violation';
  end if;
  return 'deleted';
end;
$$;

revoke execute on function public.admin_delete_plan(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Audit
-- ---------------------------------------------------------------------------
--
-- Plans decide what every subscriber earns and what they must reach to
-- withdraw, so a change to one belongs in the same trail as a config change.

drop trigger if exists trg_audit_tiers on public.tiers;
create trigger trg_audit_tiers
  after insert or update or delete on public.tiers
  for each row execute function public.audit_row_change('id');
