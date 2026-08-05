-- ============================================================================
-- Migration 101 — an account's real earning rate, not just its plan's name
--
-- The Users screen showed "Gold" and stopped there. That was a complete answer
-- while a plan had one price. It is not one now: two people on Gold who paid
-- GHS 250 and GHS 480 earn at ×2.50 and ×2.92, and the only way to see that
-- was to run SQL. It is the first question support will be asked — "why does
-- my friend earn more than me on the same plan" — so the answer belongs on the
-- screen.
--
-- Two columns: the RESOLVED multiplier (interpolation and stacking already
-- applied, straight from `resolve_user_tier`, so it cannot disagree with what
-- the ad path pays) and what the account is currently paying in total.
--
-- AND ONE PERFORMANCE FIX WHILE HERE. The tier came from
-- `(public.resolve_user_tier(p.id)).name` — and that syntax evaluates the
-- function once PER COLUMN referenced, so naively adding the multiplier beside
-- it would have run the whole tier resolution twice for every account in the
-- list. It is a LATERAL join now: one call per row, however many columns are
-- read off it.
--
-- The join is a LEFT lateral: a cross join would drop any account the
-- resolution returned nothing for, and an account silently missing from the
-- Users screen is a far worse bug than a blank rate beside it.
--
-- Body regenerated from `pg_get_functiondef` rather than retyped.
-- ============================================================================

drop function if exists public.admin_list_people(text);

create function public.admin_list_people(p_scope text DEFAULT 'all'::text)
 RETURNS TABLE(id uuid, name text, email text, phone text, avatar_path text, joined_at timestamp with time zone, balance_points bigint, tier text, status text, flagged_by text, flag_reason text, lifetime_points bigint, ads_watched integer, referrals integer, last_active_at timestamp with time zone, paid_out_ghs numeric, tier_multiplier numeric, tier_paid_ghs numeric, last_message text, last_message_at timestamp with time zone, unread integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
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

grant execute on function public.admin_list_people(text) to authenticated, service_role;
