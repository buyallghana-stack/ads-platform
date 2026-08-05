-- ============================================================================
-- Migration 103 — the two admin lists were readable with the PUBLIC key
--
-- ⚠️ THIS IS A LIVE DISCLOSURE FIX, not a hardening pass. Verified by calling
-- the project's REST endpoint with the anon key that ships inside the browser
-- bundle:
--
--   POST /rest/v1/rpc/admin_list_people  {"p_scope":"all"}   → HTTP 200
--     8 rows: id, name, EMAIL, PHONE, balance_points, lifetime_points,
--     paid_out_ghs, tier_multiplier, tier_paid_ghs, last_message, …
--   POST /rest/v1/rpc/admin_list_plans   {}                  → HTTP 200
--     every plan's revenue, subscriber counts and what buyers paid
--
-- No login. No admin. Just the publishable key, which by design is public.
--
-- TWO INDEPENDENT MISTAKES, BOTH REQUIRED FOR IT TO BE REACHABLE
--
-- 1. `create function` grants EXECUTE to PUBLIC by default. Migrations 100 and
--    101 both DROPPED and recreated these functions to widen their return
--    types, and both correctly noticed that dropping takes the grants with it —
--    then re-granted to `authenticated, service_role` without revoking the
--    default PUBLIC grant that the fresh `create` had just handed out. Adding
--    the grant back is the obvious half; taking the default away is the half
--    that is easy to miss, because nothing in the diff mentions PUBLIC.
--
-- 2. The guard reads `if auth.uid() is not null and not is_admin() then raise`.
--    A signed-out caller has a NULL uid, so the condition is false and the
--    guard never fires. That `is not null` is deliberate — the test harness
--    connects as the table owner, where there is no JWT and `auth.uid()` is
--    null — but it means the check protects against the wrong caller (a
--    signed-in non-admin) and waves through the worst one (nobody at all).
--
-- THE FIX IS BOTH HALVES, because either one alone leaves a live hole:
--
--   the grant   is the real boundary. PostgREST will not expose an RPC the
--               caller's role cannot execute, so revoking from anon closes the
--               endpoint outright.
--   the guard   is defence in depth for the day somebody re-creates one of
--               these functions again and the ACL resets a third time.
--
-- The guard tests `auth.role()`, not `auth.uid()`. Inside a SECURITY DEFINER
-- function `current_user` is the OWNER, so it cannot be used to identify the
-- caller; `auth.role()` reads the request's JWT claim and returns 'anon' for
-- the publishable key. On the owner connection there is no request setting at
-- all, so it returns null and the harness still works — which is the property
-- that let the original `is not null` escape exist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Close the endpoints
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_list_people(text) from public, anon;
revoke execute on function public.admin_list_plans() from public, anon;

grant execute on function public.admin_list_people(text) to authenticated, service_role;
grant execute on function public.admin_list_plans() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. …and refuse the caller even if the grant comes back
-- ---------------------------------------------------------------------------
--
-- Only the guard changes in either function. Both bodies are otherwise the
-- ones read back out of the live database with `pg_get_functiondef`, because
-- retyping a SECURITY DEFINER function from memory is how migration 081 lost
-- three guards.

create or replace function public.assert_not_anonymous()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  /* Null means "no request context" — the owner connection the test harness
     uses. 'anon' means a real HTTP caller holding nothing but the publishable
     key, and no admin screen is ever reached that way. */
  if coalesce((select auth.role()), '') = 'anon' then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function public.assert_not_anonymous() is
  'Refuses a caller holding only the public key. Paired with is_admin() in the admin list functions, whose own guard skips a null auth.uid().';

revoke execute on function public.assert_not_anonymous() from public, anon;
grant execute on function public.assert_not_anonymous() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. The two bodies, unchanged except for the guard
-- ---------------------------------------------------------------------------
--
-- Read back with pg_get_functiondef and replayed with one line added, so that
-- nothing else in either function can drift while fixing the guard.

CREATE OR REPLACE FUNCTION public.admin_list_people(p_scope text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, name text, email text, phone text, avatar_path text, joined_at timestamp with time zone, balance_points bigint, tier text, status text, flagged_by text, flag_reason text, lifetime_points bigint, ads_watched integer, referrals integer, last_active_at timestamp with time zone, paid_out_ghs numeric, tier_multiplier numeric, tier_paid_ghs numeric, last_message text, last_message_at timestamp with time zone, unread integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    p.avatar_path,
    p.created_at,
    coalesce(b.balance, 0),
    ut.name,

    case
      when p.disabled_at is not null then 'disabled'
      when p.flagged_at  is not null then 'flagged'
      else 'active'
    end,

    case
      when p.flagged_at is null      then null
      when p.flagged_by is not null  then 'admin'
      else 'system'
    end,
    p.flagged_reason,

    coalesce(b.lifetime_earned, 0),

    (select count(*)::int from public.points_ledger l
      where l.user_id = p.id and l.entry_type in ('ad_view', 'survey')),

    (select count(*)::int from public.profiles r where r.referred_by = p.id),

    greatest(
      p.created_at,
      coalesce((select max(l.created_at) from public.points_ledger l where l.user_id = p.id), p.created_at),
      coalesce((select max(s.signed_in_at) from public.user_session_records s where s.user_id = p.id), p.created_at)
    ),

    coalesce((select sum(q.currency_amount) from public.redemptions q
               where q.user_id = p.id and q.status = 'paid'), 0),

    /* What this account actually EARNS AT, and what it paid to get there.
       Since plans became bands, two people on the same plan can earn at
       different rates, so the plan's name no longer answers "why is this
       person earning what they are earning". The multiplier is the resolved
       one — stacking and the interpolated rate included. */
    ut.reward_multiplier,

    coalesce((select sum(coalesce(s.amount_minor, tr.price_minor))::numeric / 100
                from public.user_subscriptions s
                join public.tiers tr on tr.id = s.tier_id
               where s.user_id = p.id
                 and s.status in ('active', 'grace')), 0),

    -- The message columns. Null for a person who has never written, which is
    -- exactly what the Users and Flagged cards want to render: nothing.
    (select m.body from public.support_messages m
      where m.user_id = p.id order by m.created_at desc limit 1),

    t.last_message_at,

    (select count(*)::int from public.support_messages m
      where m.user_id = p.id and m.author = 'user' and m.read_at is null)

  from public.profiles p
  join auth.users u on u.id = p.id
  /* LEFT, deliberately. A cross join drops any row the function returns
     nothing for — and the failure mode of that is an account vanishing from
     the Users screen entirely, which is far worse than a blank rate beside
     it. */
  left join lateral public.resolve_user_tier(p.id) as ut on true
  left join public.user_balances b on b.user_id = p.id
  left join public.support_threads t on t.user_id = p.id
  where
    case p_scope
      -- Filtered in SQL, not in the browser: Flagged means the flagged ones
      -- and Messages means the ones who have actually written. A screen that
      -- fetches everybody and hides most of it has still sent everybody.
      when 'flagged'  then (p.flagged_at is not null or p.disabled_at is not null)
      when 'messages' then t.user_id is not null
      else true
    end
    -- A finalised deletion scrambles the auth row and renames the profile to
    -- 'Deleted user'. Those are not people an operator can act on.
    and p.deleted_at is null
  order by
    -- Messages is a conversation list: whoever spoke last is at the top.
    -- The key is null for every row under the other scopes, so their order is
    -- untouched — anything needing attention first, then newest.
    case when p_scope = 'messages' then t.last_message_at end desc nulls last,
    case when p.disabled_at is not null then 0
         when p.flagged_at  is not null then 1
         else 2 end,
    p.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_plans()
 RETURNS TABLE(id uuid, slug text, name text, description text, price_ghs numeric, band_max_ghs numeric, own_band_max_ghs numeric, own_band_max_multiplier numeric, billing_period_days integer, daily_ad_cap integer, reward_multiplier numeric, redemption_minimum_points bigint, referral_bonus_multiplier numeric, ad_priority integer, ad_cooldown_seconds integer, is_default boolean, is_active boolean, sort_order integer, active integer, active_last_month integer, monthly_ghs numeric, paid_count integer, paid_above_floor integer, paid_avg_ghs numeric)
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

revoke execute on function public.admin_list_people(text) from public, anon;
revoke execute on function public.admin_list_plans() from public, anon;
grant execute on function public.admin_list_people(text) to authenticated, service_role;
grant execute on function public.admin_list_plans() to authenticated, service_role;
