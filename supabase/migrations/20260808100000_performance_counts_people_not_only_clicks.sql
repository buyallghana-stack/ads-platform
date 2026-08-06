-- ============================================================================
-- Migration 149 — the funnel needs a middle
--
-- `affiliate_performance` (148) returns clicks and conversions. The dashboard
-- reference puts a third figure between them, and it is the one that makes the
-- other two mean something:
--
--     clicks  ──▶  people  ──▶  sales  ──▶  rate
--     1,254        356          78          6.22%
--
-- Without the middle column, 1,254 clicks and 78 sales is a ratio an affiliate
-- cannot act on. It does not say whether they reached 1,200 people once or 40
-- people thirty times each — which are opposite problems with opposite fixes
-- (the first needs better copy, the second is somebody refreshing a page).
--
-- ---------------------------------------------------------------------------
-- WHAT COUNTS AS A PERSON
--
-- `count(distinct visitor_token)`. The token is the cookie the middleware sets
-- on the click and the same one attribution matches against later, so this
-- counts exactly the population that could convert — no more, no less.
--
-- NOT distinct IP: households and mobile carriers share them, so an IP count
-- undercounts real reach and would make an affiliate's numbers look worse the
-- better they did in one place. NOT distinct user_id: it is null for everybody
-- who has not signed up yet, which is most of a click stream.
--
-- Rows with a null token are excluded by `count(distinct …)` itself, which is
-- the correct behaviour — an unidentified click is a click, and it is already
-- counted in `clicks`.
--
-- The reference labels this "Referrals". It is called `visitors` in the data
-- because that is what it is; "referrals" is a word Phase 1 already uses for
-- the two-level signup programme, and giving one word two meanings across two
-- businesses is how the two sets of numbers eventually get added together.
-- ============================================================================

create or replace function public.affiliate_performance(
  p_user_id uuid,
  p_days    int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_aff   uuid;
  v_days  int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from  date;
  v_prev  date;
  v_series jsonb;
  v_now   record;
  v_then  record;
begin
  select id into v_aff from public.affiliate_accounts where user_id = p_user_id;

  if v_aff is null then
    return jsonb_build_object(
      'days', v_days, 'series', '[]'::jsonb,
      'earned_minor', 0, 'clicks', 0, 'visitors', 0, 'conversions', 0,
      'prev_earned_minor', 0, 'prev_clicks', 0, 'prev_visitors', 0, 'prev_conversions', 0
    );
  end if;

  v_from := (public.utc_today() - make_interval(days => v_days - 1))::date;
  v_prev := (v_from - make_interval(days => v_days))::date;

  /* Gap-filled: a day with no activity is a zero, never a missing point. */
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'day',          to_char(d.day, 'YYYY-MM-DD'),
             'earned_minor', coalesce(m.earned, 0),
             'clicks',       coalesce(c.clicks, 0),
             'conversions',  coalesce(v.conversions, 0)
           ) order by d.day
         ), '[]'::jsonb)
    into v_series
    from generate_series(v_from, public.utc_today()::date, interval '1 day') as d(day)
    left join (
      select (created_at at time zone 'UTC')::date as day,
             sum(amount_minor) as earned
        from public.commission_ledger
       where affiliate_id = v_aff
         and status <> 'reversed'
         and (entry_type = 'credit'
              or (entry_type = 'adjustment' and amount_minor > 0))
         and (created_at at time zone 'UTC')::date >= v_from
       group by 1
    ) m on m.day = d.day::date
    left join (
      select (created_at at time zone 'UTC')::date as day, count(*) as clicks
        from public.affiliate_clicks
       where affiliate_id = v_aff
         and (created_at at time zone 'UTC')::date >= v_from
       group by 1
    ) c on c.day = d.day::date
    left join (
      select (created_at at time zone 'UTC')::date as day, count(*) as conversions
        from public.conversions
       where (affiliate_id = v_aff or l2_affiliate_id = v_aff)
         and status = 'attributed'
         and (created_at at time zone 'UTC')::date >= v_from
       group by 1
    ) v on v.day = d.day::date;

  /*
    ⚠️ `visitors` is NOT summable across the series and is deliberately absent
    from it. Somebody who clicks on Monday and again on Friday is one person in
    a weekly total and would be two if the daily counts were added — so the
    figure exists only at the window level, where it can be counted once.
  */
  select
    coalesce((select sum(amount_minor) from public.commission_ledger
               where affiliate_id = v_aff and status <> 'reversed'
                 and (entry_type = 'credit'
                      or (entry_type = 'adjustment' and amount_minor > 0))
                 and (created_at at time zone 'UTC')::date >= v_from), 0) as earned,
    coalesce((select count(*) from public.affiliate_clicks
               where affiliate_id = v_aff
                 and (created_at at time zone 'UTC')::date >= v_from), 0) as clicks,
    coalesce((select count(distinct visitor_token) from public.affiliate_clicks
               where affiliate_id = v_aff
                 and (created_at at time zone 'UTC')::date >= v_from), 0) as visitors,
    coalesce((select count(*) from public.conversions
               where (affiliate_id = v_aff or l2_affiliate_id = v_aff)
                 and status = 'attributed'
                 and (created_at at time zone 'UTC')::date >= v_from), 0) as convs
  into v_now;

  select
    coalesce((select sum(amount_minor) from public.commission_ledger
               where affiliate_id = v_aff and status <> 'reversed'
                 and (entry_type = 'credit'
                      or (entry_type = 'adjustment' and amount_minor > 0))
                 and (created_at at time zone 'UTC')::date >= v_prev
                 and (created_at at time zone 'UTC')::date <  v_from), 0) as earned,
    coalesce((select count(*) from public.affiliate_clicks
               where affiliate_id = v_aff
                 and (created_at at time zone 'UTC')::date >= v_prev
                 and (created_at at time zone 'UTC')::date <  v_from), 0) as clicks,
    coalesce((select count(distinct visitor_token) from public.affiliate_clicks
               where affiliate_id = v_aff
                 and (created_at at time zone 'UTC')::date >= v_prev
                 and (created_at at time zone 'UTC')::date <  v_from), 0) as visitors,
    coalesce((select count(*) from public.conversions
               where (affiliate_id = v_aff or l2_affiliate_id = v_aff)
                 and status = 'attributed'
                 and (created_at at time zone 'UTC')::date >= v_prev
                 and (created_at at time zone 'UTC')::date <  v_from), 0) as convs
  into v_then;

  return jsonb_build_object(
    'days',              v_days,
    'series',            v_series,
    'earned_minor',      v_now.earned,
    'clicks',            v_now.clicks,
    'visitors',          v_now.visitors,
    'conversions',       v_now.convs,
    'prev_earned_minor', v_then.earned,
    'prev_clicks',       v_then.clicks,
    'prev_visitors',     v_then.visitors,
    'prev_conversions',  v_then.convs
  );
end;
$function$;

comment on function public.affiliate_performance(uuid, int) is
  'Series + this-window and previous-window totals for the affiliate dashboard. Gap-filled, because a line drawn across absent days claims activity there was none. `visitors` is distinct visitor_token and exists only at window level — daily distinct counts do not sum.';

/* ⚠️ `create or replace function` re-grants EXECUTE to PUBLIC. */
revoke execute on function public.affiliate_performance(uuid, int) from public, anon, authenticated;
grant  execute on function public.affiliate_performance(uuid, int) to service_role;
