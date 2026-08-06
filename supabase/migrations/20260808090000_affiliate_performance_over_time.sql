-- ============================================================================
-- Migration 148 — the affiliate dashboard gets a shape, not just a total
--
-- `affiliate_dashboard` answers "how much" and "how many" over a fixed 30 days.
-- The design reference asks two further questions it cannot answer:
--
--   1. what does the last N days LOOK like — the two-line Performance Overview
--   2. is that better or worse than the N days before it — "+12.5% vs …"
--
-- Both are read-only aggregates over data that already exists. Nothing here
-- stores a derived figure; there is no cache to go stale.
--
-- ---------------------------------------------------------------------------
-- WHY ONE FUNCTION AND NOT THREE
--
-- The screen needs the series, this window's totals and the previous window's
-- totals in the same paint. Three RPCs is three round trips from a phone on
-- Ghanaian mobile data for one card, and — worse — three chances for the
-- series and the headline above it to be computed over subtly different
-- windows and disagree on screen.
--
-- ---------------------------------------------------------------------------
-- WHY THE SERIES IS GAP-FILLED
--
-- `generate_series` supplies every day in the window and the aggregates left
-- join onto it, so a day with no clicks arrives as 0 rather than as a missing
-- point. A line chart that skips absent days draws a straight segment across
-- them, which reads as steady activity over a period when there was none —
-- it turns the honest answer (nothing happened) into a flattering one.
--
-- ---------------------------------------------------------------------------
-- WHICH MONEY COUNTS, AND WHEN
--
-- `earned_minor` is credits plus adjustments in the affiliate's favour, dated
-- by `created_at` and excluding rows whose status is `reversed`. That is the
-- same definition `affiliate_dashboard` uses (migration 132), quoted here
-- deliberately rather than re-derived: if the two ever disagree, the chart and
-- the total above it disagree, and the user is right to trust neither.
--
-- A reversal is NOT subtracted from the day the sale happened. It is its own
-- event on the day it happened, because backdating a clawback would silently
-- rewrite a chart the affiliate has already looked at.
--
-- ---------------------------------------------------------------------------
-- CONVERSIONS COUNT FOR BOTH LEVELS
--
-- `affiliate_id = v_aff OR l2_affiliate_id = v_aff`, matching the dashboard.
-- A professional affiliate's own dashboard should show sales they were paid
-- for, and an override on somebody else's sale is a sale they were paid for.
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

  /* Not an affiliate: an empty, well-formed answer rather than an error. This
     is reachable by every signed-in user, and the caller should render an
     empty chart, not a 500. */
  if v_aff is null then
    return jsonb_build_object(
      'days', v_days, 'series', '[]'::jsonb,
      'earned_minor', 0, 'clicks', 0, 'conversions', 0,
      'prev_earned_minor', 0, 'prev_clicks', 0, 'prev_conversions', 0
    );
  end if;

  v_from := (public.utc_today() - make_interval(days => v_days - 1))::date;
  v_prev := (v_from - make_interval(days => v_days))::date;

  /* ---------------------------------------------------------------- */
  /* The series — one row per day in the window, zeros included.        */
  /* ---------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------- */
  /* This window, and the one immediately before it.                    */
  /* ---------------------------------------------------------------- */
  select
    coalesce((select sum(amount_minor) from public.commission_ledger
               where affiliate_id = v_aff and status <> 'reversed'
                 and (entry_type = 'credit'
                      or (entry_type = 'adjustment' and amount_minor > 0))
                 and (created_at at time zone 'UTC')::date >= v_from), 0) as earned,
    coalesce((select count(*) from public.affiliate_clicks
               where affiliate_id = v_aff
                 and (created_at at time zone 'UTC')::date >= v_from), 0) as clicks,
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
    'conversions',       v_now.convs,
    'prev_earned_minor', v_then.earned,
    'prev_clicks',       v_then.clicks,
    'prev_conversions',  v_then.convs
  );
end;
$function$;

comment on function public.affiliate_performance(uuid, int) is
  'Series + this-window and previous-window totals for the affiliate dashboard chart. Gap-filled: a day with no activity is a zero, never a missing point, because a line drawn across absent days claims activity there was none.';

/* ⚠️ `create function` re-grants EXECUTE to PUBLIC. Phase 2 convention
   (migration 127): server-only, reached through the admin client, which is
   also what makes "view as user" work. */
revoke execute on function public.affiliate_performance(uuid, int) from public, anon, authenticated;
grant  execute on function public.affiliate_performance(uuid, int) to service_role;
