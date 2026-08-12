-- ============================================================================
-- Migration 184 — the ads split must account for every ad row, reference or not
--
-- Caught by `tests/money/earnings-breakdown.test.ts` on the day it was written:
-- the parts summed to 650 while the page called the total 1450.
--
-- `get_earnings_breakdown` built its videos/surveys/articles figures from
-- ledger rows that carry a usable `reference_id`, because the only way to tell
-- a video from an article is to look up `ads.format`. Any `ad_view` or
-- `survey` row WITHOUT one contributed to the total and to no line beneath it,
-- so the breakdown silently stopped adding up. Which is the one thing this
-- page exists not to do.
--
-- The split now starts from every `ad_view` and `survey` row and looks the ad
-- up only to choose between video and article. Where it cannot, the entry type
-- decides: a survey is a survey, and anything else was a video, which is what
-- the feed was before articles existed. So the three lines always sum to what
-- the ads earned, whatever state the reference is in.
-- ============================================================================

create or replace function public.get_earnings_breakdown(p_user_id uuid)
returns table (
  videos_points              bigint,
  surveys_points             bigint,
  articles_points            bigint,
  referral_signup_points     bigint,
  referral_activation_points bigint,
  referral_purchase_points   bigint,
  game_points                bigint,
  task_points                bigint,
  gift_code_points           bigint,
  adjustment_points          bigint,
  earned_points              bigint,
  withdrawn_paid_points      bigint,
  withdrawn_pending_points   bigint,
  withdrawn_refunded_points  bigint,
  fees_currency              numeric,
  paid_out_currency          numeric,
  plans_spent_minor          bigint,
  plans_count                int,
  balance_points             bigint,
  points_per_currency_unit   bigint,
  first_earned_at            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with ad_rows as materialized (
    /* EVERY ad row, not only the ones with a resolvable reference. The CASE
       guards the cast, so a reference like `<uuid>#3` (a repeat) resolves and
       anything else simply has no ad to look up. */
    select l.entry_type, l.amount,
           case
             when l.reference_type = 'ad'
              and l.reference_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
             then substring(l.reference_id from 1 for 36)::uuid
           end as ad_id
      from public.points_ledger l
     where l.user_id = p_user_id
       and l.entry_type in ('ad_view', 'survey')
  ),
  by_format as (
    select coalesce(
             a.format::text,
             case when r.entry_type = 'survey' then 'survey' else 'video' end
           ) as fmt,
           sum(r.amount) as points
      from ad_rows r
      left join public.ads a on a.id = r.ad_id
     group by 1
  ),
  led as (
    select l.entry_type, l.amount, l.created_at
      from public.points_ledger l
     where l.user_id = p_user_id
  ),
  red as (
    select r.status::text as status, r.points_amount,
           coalesce(r.fee_amount, 0) as fee_amount,
           coalesce(r.net_amount, r.currency_amount) as net_amount
      from public.redemptions r
     where r.user_id = p_user_id
  )
  select
    coalesce((select points from by_format where fmt = 'video'), 0)::bigint,
    coalesce((select points from by_format where fmt = 'survey'), 0)::bigint,
    coalesce((select points from by_format where fmt = 'link'), 0)::bigint,

    coalesce((select sum(amount) from led where entry_type = 'referral_signup'), 0)::bigint,
    coalesce((select sum(amount) from led where entry_type = 'referral_activation'), 0)::bigint,
    coalesce((select sum(amount) from led where entry_type = 'referral_purchase'), 0)::bigint,
    coalesce((select sum(amount) from led where entry_type = 'game_prize'), 0)::bigint,
    coalesce((select sum(amount) from led where entry_type = 'task_reward'), 0)::bigint,
    coalesce((select sum(amount) from led where entry_type = 'gift_code'), 0)::bigint,
    coalesce((select sum(amount) from led where entry_type = 'admin_adjustment'), 0)::bigint,

    coalesce((select sum(amount) from led
               where entry_type not in ('redemption_request', 'redemption_refund')
                 and amount > 0), 0)::bigint,

    coalesce((select sum(points_amount) from red where status = 'paid'), 0)::bigint,
    coalesce((select sum(points_amount) from red
               where status in ('held', 'pending_approval', 'approved')), 0)::bigint,
    coalesce((select sum(points_amount) from red
               where status in ('rejected', 'cancelled', 'failed')), 0)::bigint,
    coalesce((select sum(fee_amount) from red where status = 'paid'), 0)::numeric,
    coalesce((select sum(net_amount) from red where status = 'paid'), 0)::numeric,

    coalesce((select sum(sp.amount_minor) from public.subscription_payments sp
               where sp.user_id = p_user_id and sp.status = 'confirmed'), 0)::bigint,
    coalesce((select count(*) from public.subscription_payments sp
               where sp.user_id = p_user_id and sp.status = 'confirmed'), 0)::int,

    coalesce((select b.balance from public.user_balances b where b.user_id = p_user_id), 0)::bigint,
    public.config_int('points_per_currency_unit'),
    (select min(created_at) from led where amount > 0)
$$;
