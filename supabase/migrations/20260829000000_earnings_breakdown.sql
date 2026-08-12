-- ============================================================================
-- Migration 181 — where the money came from, on both sides
--
-- Operator, 2026-08-12: a user opens their earnings breakdown from the
-- dashboard and sees what they earned through ads, referrals, games and gift
-- codes, what they have withdrawn, and what they have spent on plans. Same for
-- the affiliate, tuned to its nature.
--
-- ── THE PARTS MUST SUM TO THE BALANCE, OR THE PAGE IS WORSE THAN NOTHING ──
--
-- A breakdown that does not reconcile with the figure on the Home screen is
-- the fastest way to make somebody believe they have been short-changed. So
-- every one of the eleven `ledger_entry_type` values is accounted for here,
-- including the two the operator did not list (`task_reward` and
-- `admin_adjustment`, both approved on 2026-08-12), and the arithmetic is
-- taken FROM the ledger rather than from any table that summarises it.
--
-- ── SPENDING IS NOT NETTED AGAINST EARNING ──
--
-- Operator's decision, same day: what somebody spent on plans is stated as a
-- fact, beside their earnings, never subtracted from them. A single "you are
-- up GHS X" figure would turn a watch-to-earn product into something that
-- reads as an investment, which is precisely the framing the Owner's legal
-- opinion was careful about. There is deliberately no such column below, so
-- no screen can accidentally render one.
--
-- ── THE ADS SPLIT COMES FROM THE AD, NOT FROM THE ENTRY TYPE ──
--
-- `ad_view` covers videos AND articles: link ads never got their own entry
-- type. Only `ads.format` can tell them apart, so the ledger row is joined
-- back to the ad it paid for.
--
-- ⚠️ `points_ledger.reference_id` is NOT always a bare uuid. Since repeats
-- shipped it is `<ad id>#<occasion>` from the second completion onward
-- (`ad_occasion_ref`), so the id is the first 36 characters. The CTE is
-- MATERIALIZED on purpose: inlined, the cast could be evaluated on rows the
-- filter was meant to exclude, and one non-uuid reference would take the whole
-- page down with an invalid input syntax error.
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
    select l.entry_type, l.amount,
           substring(l.reference_id from 1 for 36)::uuid as ad_id
      from public.points_ledger l
     where l.user_id = p_user_id
       and l.reference_type = 'ad'
       and l.reference_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  ),
  by_format as (
    select coalesce(
             a.format::text,
             /* The ad is gone. The entry type still knows whether it was a
                survey; anything else was a video, which is what the feed was
                before articles existed. */
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
    /* Both directions. An adjustment that took points away is part of the
       story, and hiding it is how a breakdown stops adding up. */
    coalesce((select sum(amount) from led where entry_type = 'admin_adjustment'), 0)::bigint,

    /* Everything that ever came IN. Withdrawals and their refunds are excluded
       because a refund is money returning, not money earned. */
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

comment on function public.get_earnings_breakdown(uuid) is
  'Every earning source, every withdrawal state and lifetime plan spend for one account. Points, not cedis: the caller converts with points_per_currency_unit. Spending is never netted against earning.';


-- ---------------------------------------------------------------------------
-- The affiliate side, which is a different business and not a translation
-- ---------------------------------------------------------------------------
--
-- What does NOT carry over: ads, surveys, articles, signup and activation
-- bonuses, and points themselves. Commission is cedis from the first row.
--
-- What is new here and has no equivalent on the ads side:
--   REVERSALS. A refunded sale claws its commission back, so somebody can be
--   paid and then unpaid. It is shown as its own line rather than quietly
--   reducing the sales figure, because "my commission went down" is a support
--   conversation and the page should answer it before it starts.
--   TWO LEVELS. Own sales and the override on a recruit's sales are different
--   money to an affiliate and they always ask which is which.
--
-- `kind` classifies before `level` does: a game prize is written as an
-- adjustment with kind 'game', so reading entry_type alone would file it as an
-- administrative correction.

create or replace function public.get_commission_breakdown(p_user_id uuid)
returns table (
  sales_l1_minor        bigint,
  sales_l2_minor        bigint,
  game_minor            bigint,
  task_minor            bigint,
  gift_minor            bigint,
  adjustment_minor      bigint,
  reversed_minor        bigint,
  earned_minor          bigint,
  pending_minor         bigint,
  withdrawn_paid_minor  bigint,
  withdrawn_pending_minor bigint,
  withdrawn_rejected_minor bigint,
  fees_minor            bigint,
  net_paid_minor        bigint,
  training_spent_minor  bigint,
  training_count        int,
  sales_count           int,
  recruits_count        int,
  balance_minor         bigint,
  first_earned_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with acct as (
    select a.id from public.affiliate_accounts a where a.user_id = p_user_id
  ),
  led as (
    select l.entry_type::text as entry_type, l.kind, l.level, l.status::text as status,
           l.amount_minor, l.created_at
      from public.commission_ledger l
     where l.affiliate_id = (select id from acct)
  ),
  pay as (
    select p.status::text as status, p.amount_minor,
           coalesce(p.fee_minor, 0) as fee_minor,
           coalesce(p.net_minor, p.amount_minor) as net_minor
      from public.commission_payouts p
     where p.affiliate_id = (select id from acct)
  )
  select
    coalesce((select sum(amount_minor) from led
               where entry_type = 'credit' and coalesce(kind, 'sale') not in ('game','task','gift')
                 and coalesce(level, 1) = 1), 0)::bigint,
    coalesce((select sum(amount_minor) from led
               where entry_type = 'credit' and coalesce(kind, 'sale') not in ('game','task','gift')
                 and level = 2), 0)::bigint,

    coalesce((select sum(amount_minor) from led where kind = 'game'), 0)::bigint,
    coalesce((select sum(amount_minor) from led where kind = 'task'), 0)::bigint,
    coalesce((select sum(amount_minor) from led where kind = 'gift'), 0)::bigint,
    coalesce((select sum(amount_minor) from led
               where entry_type = 'adjustment'
                 and coalesce(kind, '') not in ('game','task','gift')), 0)::bigint,
    coalesce((select sum(amount_minor) from led where entry_type = 'reversal'), 0)::bigint,

    /* Everything that came in, before anything was taken out or clawed back. */
    coalesce((select sum(amount_minor) from led
               where entry_type in ('credit', 'adjustment') and amount_minor > 0), 0)::bigint,
    /* Earned but not yet spendable: a hold that has not cleared. */
    coalesce((select sum(amount_minor) from led
               where status = 'pending' and entry_type in ('credit','adjustment')), 0)::bigint,

    coalesce((select sum(amount_minor) from pay where status = 'paid'), 0)::bigint,
    coalesce((select sum(amount_minor) from pay
               where status in ('requested', 'approved')), 0)::bigint,
    coalesce((select sum(amount_minor) from pay where status = 'rejected'), 0)::bigint,
    coalesce((select sum(fee_minor) from pay where status = 'paid'), 0)::bigint,
    coalesce((select sum(net_minor) from pay where status = 'paid'), 0)::bigint,

    /* The affiliate's equivalent of "spent on plans": what they paid to be
       here, training and renewals and upgrades alike. */
    coalesce((select sum(o.amount_minor) from public.orders o
               where o.user_id = p_user_id and o.status = 'confirmed'), 0)::bigint,
    coalesce((select count(*) from public.orders o
               where o.user_id = p_user_id and o.status = 'confirmed'), 0)::int,

    coalesce((select count(*) from public.conversions c
               where c.affiliate_id = (select id from acct) and c.status = 'attributed'), 0)::int,
    coalesce((select count(*) from public.affiliate_accounts d
               where d.parent_affiliate_id = (select id from acct)), 0)::int,

    coalesce(public.affiliate_balance_minor((select id from acct)), 0)::bigint,
    (select min(created_at) from led where amount_minor > 0)
$$;

comment on function public.get_commission_breakdown(uuid) is
  'Commission by source and level, clawbacks, payout states and lifetime training spend for one affiliate. Minor units of cedis throughout.';


/* ⚠️ Both are SECURITY DEFINER and take a user id, which is the shape that
   made seventeen functions readable with the publishable key in migrations 103
   and 104. The anon key must not reach them: the server calls them with the
   VIEWED user's id, so an admin looking at somebody's screen sees that
   person's figures, and a signed-out caller has no way in at all. */
revoke execute on function public.get_earnings_breakdown(uuid) from public, anon, authenticated;
revoke execute on function public.get_commission_breakdown(uuid) from public, anon, authenticated;
grant execute on function public.get_earnings_breakdown(uuid) to service_role;
grant execute on function public.get_commission_breakdown(uuid) to service_role;
