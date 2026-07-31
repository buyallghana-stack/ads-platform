-- ============================================================================
-- Migration 084 — the Team screen: what a referrer may see about their team
--
-- Operator, 2026-07-31, relaying their lawyer's recommendation: add a Team tab
-- showing what the people you invited — across both levels — have bought, what
-- they have withdrawn and what they have left, IN CURRENCY, and list them
-- individually with their phone number and name. His stated reason is
-- transparency: a user who is told they earn from a team should be able to see
-- that team, so nobody can claim they were kept in the dark about what their
-- introductions were worth.
--
-- ⚠️ THIS FUNCTION DELIBERATELY DISCLOSES ONE USER'S PERSONAL AND FINANCIAL
-- DATA TO ANOTHER USER. That is the point of the feature and it was asked for
-- twice, in writing, by the operator after the alternative was spelled out. It
-- is still the single most sensitive read in this schema, so:
--
--   * The Privacy Policy says so in plain words, in its own section, naming
--     the phone number, the withdrawals and the balance. A disclosure buried
--     in a list would not be a disclosure.
--   * `team_shows_member_phone` can retract the phone number — the one field
--     that is contact data rather than programme data — without a deploy. It
--     defaults to true because that is what was asked for.
--   * NOTHING here exposes an email address, a payout destination, a PIN
--     state, a device, a fraud score or an admin flag. The list is exactly
--     what was asked for and stops there. Adding to it is a policy decision,
--     not a convenience.
--   * A referrer sees the money their team holds. They cannot move it, and
--     nothing here is writable.
--
-- THE DEPTH RULE FROM MIGRATION 083 APPLIES UNCHANGED. `team_member_ids` walks
-- exactly one join deep for level two. No recursion, so a third level cannot
-- appear on this screen any more than it can be paid.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The one setting that can retract the most sensitive column
-- ---------------------------------------------------------------------------

insert into public.app_config
  (key, value, value_type, min_value, max_value, is_public, description)
values
  ('team_shows_member_phone', 'true', 'bool', null, null, true,
   'Whether the Team screen shows each team member''s phone number to the person who introduced them. Their name and their figures are shown either way. Switching this off hides the number for everybody, immediately, without a deploy — it is here because a phone number is the one item on that screen that is contact data rather than programme data.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. team_member_ids — who is on somebody's team, and at which level
-- ---------------------------------------------------------------------------
--
-- One SELECT per level, joined once. Read it the way `second_level_referral`
-- is meant to be read: the absence of recursion is the depth limit.
--
-- `referee_id <> p_user_id` is not paranoia. A cycle is reachable (A refers B,
-- then B applies A's code before earning anything), and without it a user
-- would appear on their own team and their own balance would be counted as
-- their team's.

create or replace function public.team_member_ids(p_user_id uuid)
returns table (member_id uuid, member_level smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select r1.referee_id, 1::smallint
    from public.referrals r1
   where r1.referrer_id = p_user_id
     and r1.status <> 'rejected'
     and r1.referee_id <> p_user_id

  union all

  select r2.referee_id, 2::smallint
    from public.referrals r1
    join public.referrals r2 on r2.referrer_id = r1.referee_id
   where r1.referrer_id = p_user_id
     and r1.status <> 'rejected'
     and r2.status <> 'rejected'
     and r2.referee_id <> p_user_id;
$$;

comment on function public.team_member_ids(uuid) is
  'The user ids on somebody''s team, with 1 for people they invited and 2 for the people those people invited. Exactly one join deep — there is no third level here, as there is none in the payments.';

revoke execute on function public.team_member_ids(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. get_team_summary — the totals, per level, in CURRENCY
-- ---------------------------------------------------------------------------
--
-- Currency, not points, because that is what was asked for and because it is
-- the honest unit for this screen: a team's activity is being reported to
-- somebody as evidence, and "8,410 points" is not evidence anybody can check
-- against what they know a cedi is worth.
--
-- ALWAYS RETURNS BOTH LEVELS, zeroed when empty, so the screen never has to
-- decide whether a missing row means nothing happened or something failed.

create or replace function public.get_team_summary(p_user_id uuid)
returns table (
  member_level smallint,
  people       int,
  plans_bought int,
  plans_value  numeric,
  redeemed     numeric,
  remaining    numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_rate   bigint := greatest(coalesce(public.config_int('points_per_currency_unit'), 1000), 1);
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised' using errcode = 'insufficient_privilege';
  end if;

  return query
  with members as (
    select m.member_id as id, m.member_level as lvl
      from public.team_member_ids(p_user_id) m
  ),
  per_level as (
    select mm.lvl,
           count(*)::int                        as people,
           coalesce(sum(sp.n), 0)::int          as plans_bought,
           coalesce(sum(sp.value_minor), 0)     as value_minor,
           coalesce(sum(rd.paid), 0)            as redeemed,
           coalesce(sum(ub.balance), 0)         as points_left
      from members mm
      left join lateral (
        select count(*) as n, sum(s.amount_minor) as value_minor
          from public.subscription_payments s
         where s.user_id = mm.id and s.status = 'confirmed'
      ) sp on true
      left join lateral (
        -- Money that actually left, not money requested. A withdrawal sitting
        -- in the review queue has not been withdrawn, and reporting it as
        -- though it had would misstate somebody else's finances.
        select sum(r.currency_amount) as paid
          from public.redemptions r
         where r.user_id = mm.id and r.status = 'paid'
      ) rd on true
      left join public.user_balances ub on ub.user_id = mm.id
     group by mm.lvl
  )
  select v.lvl,
         coalesce(pl.people, 0),
         coalesce(pl.plans_bought, 0),
         round(coalesce(pl.value_minor, 0)::numeric / 100.0, 2),
         round(coalesce(pl.redeemed, 0), 2),
         round(coalesce(pl.points_left, 0)::numeric / v_rate, 2)
    from (values (1::smallint), (2::smallint)) as v(lvl)
    left join per_level pl on pl.lvl = v.lvl
   order by v.lvl;
end;
$$;

comment on function public.get_team_summary(uuid) is
  'Per-level totals for somebody''s referral team, in currency: how many people, how many plans they bought, what those plans were worth, what they have been paid out, and what their remaining balances are worth.';

revoke execute on function public.get_team_summary(uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- 4. get_team_members — the people, one row each
-- ---------------------------------------------------------------------------
--
-- The sensitive one. See the header before adding a column to it.

create or replace function public.get_team_members(p_user_id uuid)
returns table (
  member_level smallint,
  member_id    uuid,
  full_name    text,
  phone        text,
  avatar_path  text,
  joined_at    timestamptz,
  top_plan     text,
  extra_plans  int,
  plans_bought int,
  plans_value  numeric,
  redeemed     numeric,
  remaining    numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_rate   bigint := greatest(coalesce(public.config_int('points_per_currency_unit'), 1000), 1);
  v_phone  boolean := coalesce(public.config_bool('team_shows_member_phone'), true);
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised' using errcode = 'insufficient_privilege';
  end if;

  return query
  select m.member_level,
         p.id,
         -- Whatever they chose to be called. Null is a real state: a profile
         -- with no name renders as a placeholder rather than as an empty row.
         p.full_name,
         case when v_phone then p.phone else null end,
         p.avatar_path,
         p.created_at,
         /* WHAT THEY ARE ON RIGHT NOW, not what they have ever bought.
            Plans stack one-of-each, so somebody can hold four at once and
            there is no single "their plan" to report. The operator's rule:
            name the highest and count the rest — Platinum + 2. Highest is by
            `sort_order`, which is the same order the plans are priced and
            displayed in, so the screen cannot disagree with the Upgrade tab.
            Somebody holding none is on the default tier, which is a real
            standing rather than an absence — Free, not a blank. */
         coalesce(plans.top_name, dflt.name),
         greatest(coalesce(plans.held, 0) - 1, 0)::int,
         coalesce(sp.n, 0)::int,
         round(coalesce(sp.value_minor, 0)::numeric / 100.0, 2),
         round(coalesce(rd.paid, 0), 2),
         round(coalesce(ub.balance, 0)::numeric / v_rate, 2)
    from public.team_member_ids(p_user_id) m
    join public.profiles p on p.id = m.member_id
    left join lateral (
      select count(*) as held,
             (array_agg(t.name order by t.sort_order desc, t.price_minor desc))[1] as top_name
        from public.user_subscriptions us
        join public.tiers t on t.id = us.tier_id
       where us.user_id = m.member_id and us.status in ('active', 'grace')
    ) plans on true
    left join lateral (
      select t.name from public.tiers t where t.is_default limit 1
    ) dflt on true
    left join lateral (
      select count(*) as n, sum(s.amount_minor) as value_minor
        from public.subscription_payments s
       where s.user_id = m.member_id and s.status = 'confirmed'
    ) sp on true
    left join lateral (
      select sum(r.currency_amount) as paid
        from public.redemptions r
       where r.user_id = m.member_id and r.status = 'paid'
    ) rd on true
    left join public.user_balances ub on ub.user_id = m.member_id
   -- Oldest first: the list is a history of who joined, and a stable order
   -- means the row numbers on screen do not shuffle between visits.
   order by m.member_level, p.created_at, p.id;
end;
$$;

comment on function public.get_team_members(uuid) is
  'The people on somebody''s referral team, both levels, with the figures the operator''s lawyer asked to be transparent about. DISCLOSES ANOTHER USER''S PHONE, WITHDRAWALS AND BALANCE — see the migration header and the Privacy Policy before extending it.';

revoke execute on function public.get_team_members(uuid) from public, anon;
