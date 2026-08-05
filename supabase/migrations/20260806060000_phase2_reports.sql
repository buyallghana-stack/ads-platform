-- ============================================================================
-- Migration 117 — PHASE 2, step 7 of 7: the reports the programme is watched by
--
-- Three read-only functions. No money moves, nothing is written.
--
-- Two of them exist because of the C16 decision — training sales pay
-- commission at both levels — and they are the reason that decision is
-- MEASURABLE rather than assumed:
--
--   affiliate_recruitment_share      across the whole programme
--   admin_affiliate_promotion_report per person, which the Owner asked for in
--                                    G44: "how every user is also performing
--                                    by how they refer, this will enable me to
--                                    suspend them if they are more focus on
--                                    referrals than promoting sales"
--
-- The third is H48: per-affiliate earnings per year, exportable, so the
-- figures exist if a withholding obligation ever turns out to apply.
--
-- ---------------------------------------------------------------------------
-- EVERY FIGURE IS NET OF REVERSALS
--
-- Reversals are negative rows, so summing `credit` and `reversal` together
-- gives what somebody actually kept. Reporting gross would credit people for
-- refunded sales — Phase 1 learned this on its points leaderboard, where a
-- board counting money later taken back is both wrong and farmable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Is the programme selling, or recruiting?
-- ---------------------------------------------------------------------------
--
-- The single number a regulator would ask for, and the one the Owner should
-- watch. If most commission income comes from people buying TRAINING rather
-- than from people buying real products, the programme is funded by
-- recruitment — which is exactly the shape §4.6 of the brief is about.
--
-- Making it visible costs one query. Not having it means the question can only
-- be answered by writing SQL under pressure.

create or replace function public.affiliate_recruitment_share(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  training_minor         bigint,
  product_minor          bigint,
  total_minor            bigint,
  recruitment_share_pct  numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with paid as (
    select p.purpose, sum(l.amount_minor) as minor
      from public.commission_ledger l
      join public.conversions c on c.id = l.conversion_id
      join public.orders o      on o.id = c.order_id
      join public.products p    on p.id = o.product_id
     where l.entry_type in ('credit', 'reversal')
       and l.created_at >= p_from
       and l.created_at <  p_to
     group by p.purpose
  ),
  totals as (
    select
      coalesce((select minor from paid where purpose = 'training_program'), 0)::bigint as training_minor,
      coalesce((select minor from paid where purpose = 'vendor_product'), 0)::bigint   as product_minor
  )
  select t.training_minor,
         t.product_minor,
         (t.training_minor + t.product_minor)::bigint as total_minor,
         case
           when t.training_minor + t.product_minor <= 0 then 0
           else round(t.training_minor * 100.0 / (t.training_minor + t.product_minor), 1)
         end as recruitment_share_pct
    from totals t;
$$;

comment on function public.affiliate_recruitment_share(timestamptz, timestamptz) is
  'What share of commission came from TRAINING sales rather than real product sales. The number that says whether the programme is driven by selling or by recruiting. Net of reversals.';

revoke execute on function public.affiliate_recruitment_share(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.affiliate_recruitment_share(timestamptz, timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 2. The same question, per person
-- ---------------------------------------------------------------------------
--
-- Sortable by `recruitment_share_pct`, so whoever earns mostly from recruiting
-- sorts to the top — which is what the Owner asked for.
--
-- ⚠️ A CAUTION THAT BELONGS WITH THE REPORT RATHER THAN IN A CONVERSATION.
-- A high recruitment share is not proof of anything on its own. A genuinely
-- good recruiter who also sells looks identical to a pure recruiter EARLY ON,
-- because their downline has not sold anything yet. This report flags; a human
-- decides. Nothing here should ever drive an automatic suspension.

create or replace function public.admin_affiliate_promotion_report(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns table (
  affiliate_id           uuid,
  user_id                uuid,
  name                   text,
  affiliate_code         text,
  status                 text,
  product_commission_minor  bigint,
  training_commission_minor bigint,
  total_commission_minor    bigint,
  recruitment_share_pct     numeric,
  recruits               int,
  product_sales          int,
  training_sales         int,
  clicks                 int,
  conversion_rate_pct    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with earned as (
    select l.affiliate_id,
           sum(l.amount_minor) filter (where p.purpose = 'vendor_product')   as product_minor,
           sum(l.amount_minor) filter (where p.purpose = 'training_program') as training_minor,
           count(*) filter (where p.purpose = 'vendor_product'   and l.entry_type = 'credit') as product_sales,
           count(*) filter (where p.purpose = 'training_program' and l.entry_type = 'credit') as training_sales
      from public.commission_ledger l
      join public.conversions c on c.id = l.conversion_id
      join public.orders o      on o.id = c.order_id
      join public.products p    on p.id = o.product_id
     where l.entry_type in ('credit', 'reversal')
       and l.created_at >= p_from
       and l.created_at <  p_to
     group by l.affiliate_id
  ),
  traffic as (
    select affiliate_id, count(*)::int as clicks
      from public.affiliate_clicks
     where created_at >= p_from and created_at < p_to
     group by affiliate_id
  ),
  recruited as (
    select parent_affiliate_id as affiliate_id, count(*)::int as recruits
      from public.affiliate_accounts
     where parent_affiliate_id is not null
       and created_at >= p_from and created_at < p_to
     group by parent_affiliate_id
  )
  select a.id,
         a.user_id,
         coalesce(pr.full_name, '')::text,
         a.affiliate_code,
         a.status::text,
         coalesce(e.product_minor, 0)::bigint,
         coalesce(e.training_minor, 0)::bigint,
         (coalesce(e.product_minor, 0) + coalesce(e.training_minor, 0))::bigint,
         case
           when coalesce(e.product_minor, 0) + coalesce(e.training_minor, 0) <= 0 then 0
           else round(coalesce(e.training_minor, 0) * 100.0
                      / (coalesce(e.product_minor, 0) + coalesce(e.training_minor, 0)), 1)
         end,
         coalesce(r.recruits, 0),
         coalesce(e.product_sales, 0)::int,
         coalesce(e.training_sales, 0)::int,
         coalesce(t.clicks, 0),
         /* Whether they are promoting at all. Clicks with no conversions is a
            different problem from no clicks — one is a message that is not
            working, the other is nobody sharing anything. */
         case
           when coalesce(t.clicks, 0) = 0 then 0
           else round(
             (coalesce(e.product_sales, 0) + coalesce(e.training_sales, 0)) * 100.0
             / t.clicks, 1)
         end
    from public.affiliate_accounts a
    left join public.profiles pr on pr.id = a.user_id
    left join earned    e on e.affiliate_id = a.id
    left join traffic   t on t.affiliate_id = a.id
    left join recruited r on r.affiliate_id = a.id
   order by 9 desc nulls last, 8 desc;
$$;

comment on function public.admin_affiliate_promotion_report(timestamptz, timestamptz) is
  'Per affiliate: what they earned from products versus from training, their recruitment share, recruits, and whether they are promoting at all. Sorted by recruitment share. Flags for a human — never drive an automatic suspension from this.';

revoke execute on function public.admin_affiliate_promotion_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_affiliate_promotion_report(timestamptz, timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Earnings by year (H48)
-- ---------------------------------------------------------------------------
--
-- Withholding is not implemented and may never be. The RECORD is built now
-- anyway, because reconstructing it later from ledger rows spread across
-- statuses, levels and reversals is genuinely painful, and if an obligation
-- ever applies the historical figures are needed regardless of whether the
-- system deducts anything.

create or replace function public.affiliate_earnings_by_year(p_year int default null)
returns table (
  affiliate_id  uuid,
  user_id       uuid,
  name          text,
  year          int,
  gross_minor   bigint,
  reversed_minor bigint,
  net_minor     bigint,
  paid_out_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.user_id,
         coalesce(pr.full_name, '')::text,
         extract(year from l.created_at)::int as year,
         coalesce(sum(l.amount_minor) filter (where l.entry_type = 'credit'), 0)::bigint,
         coalesce(sum(l.amount_minor) filter (where l.entry_type = 'reversal'), 0)::bigint,
         coalesce(sum(l.amount_minor) filter (where l.entry_type in ('credit', 'reversal')), 0)::bigint,
         coalesce(sum(-l.amount_minor) filter (where l.entry_type = 'payout' and l.status = 'paid'), 0)::bigint
    from public.commission_ledger l
    join public.affiliate_accounts a on a.id = l.affiliate_id
    left join public.profiles pr on pr.id = a.user_id
   where p_year is null or extract(year from l.created_at)::int = p_year
   group by a.id, a.user_id, pr.full_name, extract(year from l.created_at)
   order by 4 desc, 7 desc;
$$;

comment on function public.affiliate_earnings_by_year(int) is
  'Per affiliate per calendar year: gross earned, reversed, net, and paid out. Built now so the figures exist if a withholding obligation ever applies (H48).';

revoke execute on function public.affiliate_earnings_by_year(int) from public, anon, authenticated;
grant execute on function public.affiliate_earnings_by_year(int) to service_role;
