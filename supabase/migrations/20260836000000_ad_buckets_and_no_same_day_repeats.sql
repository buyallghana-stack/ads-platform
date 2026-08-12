-- ============================================================================
-- Migration 188 — a bucket per plan, and an ad is not paid twice in one day
--
-- Operator, 2026-08-12, two things in one message.
--
-- ── 1. "WHAT ADS SERVE WHAT TIER" ──
--
-- The admin pool is one flat list, so there is no way to see what a Gold
-- member's day actually contains. The operator wants a bucket per plan: Free,
-- Bronze, Silver, Gold, Platinum, each holding that plan's daily limit of ads.
--
-- The plumbing for this has existed since the ad pool was built: `ad_tiers`
-- tags an ad to a plan, and `ad_targeting_includes_lower_tiers` decides whether
-- a tag means "this plan" or "this plan and up". It was simply never used —
-- 1 row in `ad_tiers` against 11 live ads, so everybody sees everything.
--
-- **The operator chose EXCLUSIVE** (asked, and answered "B"): an ad in the
-- Bronze bucket is for Bronze holders and nobody else. I flagged the cost and
-- they took it: every bucket must hold at least its own plan's daily limit or
-- that plan runs out mid-day, because there is no longer a bigger bucket
-- underneath to absorb the shortfall. The admin screen now shows a readiness
-- line per bucket so an under-filled one is visible rather than discovered.
--
-- Stacking is unaffected: `user_target_tiers` returns every plan a person
-- holds, so somebody holding all four still sees all four buckets. An ad with
-- NO tag stays visible to everyone, which is what keeps the eleven existing
-- ads serving, and the admin lists those as their own bucket rather than
-- hiding them.
--
-- ── 2. ONE ARTICLE, SEVENTEEN TIMES ──
--
-- Operator: "i was able to watch articles for several times abandoning the
-- video and survey". Confirmed in the data: the single link ad had
-- `times_completed = 17` on 2026-08-12, and the day's counter read 27 ads for
-- 12,579 points. The daily cap was the ONLY thing that stopped it.
--
-- `ad_repeat_min_hours` is 0, so a finished ad returns to the feed instantly,
-- and the Articles tab filters to one format — with one article in the pool,
-- "oldest finished first" is that same article forever.
--
-- The rule is now a DAY, not an interval: **an ad completed today is not
-- offered again today.** That is what the operator described ("no repetition,
-- it only repeats if i forgot to add different ads the next day") and it is
-- also the honest shape of the thing, because a person's allowance resets by
-- day and so should the pool they draw it from. `ad_repeat_min_hours` still
-- applies on top for an operator who wants longer than a day.
--
-- ⚠️ BOTH SIDES, OR NEITHER. The feed decides what to offer and
-- `register_ad_view` decides what to accept. They already agreed about repeats
-- and they have to keep agreeing, or an ad hidden from the feed is still
-- payable by anyone who taps the previous one twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The switches
-- ---------------------------------------------------------------------------

update public.app_config
   set value = 'false',
       description = 'When false (the operator''s choice, 2026-08-12), an ad tagged to a plan '
                     || 'is shown to that plan ONLY. When true, it is also shown to every plan '
                     || 'above it. An ad with no tag at all is shown to everybody either way.'
 where key = 'ad_targeting_includes_lower_tiers';

insert into public.app_config (key, value, value_type, description)
select 'ad_repeat_same_day', 'false', 'bool',
       'Whether an ad already completed today may be watched again the same day. '
       || 'False since 2026-08-12: one article was watched 17 times in a day because '
       || 'the only limit was the daily ad cap. With it off, a finished ad returns '
       || 'tomorrow, so a day with too few ads shows "caught up" rather than paying '
       || 'twice for the same view.'
 where not exists (select 1 from public.app_config where key = 'ad_repeat_same_day');


-- ---------------------------------------------------------------------------
-- One place that decides whether a finished ad may come back
-- ---------------------------------------------------------------------------
--
-- Written as a function rather than as the same predicate in two places,
-- because the feed and `register_ad_view` disagreeing is exactly the bug shape
-- this rule invites: an ad the feed will not show is still payable by anybody
-- who reaches it another way.

create or replace function public.ad_repeat_ready(p_finished_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    p_finished_at is null
    or (
      /* Not again today. `utc_today()` is the same day boundary the daily
         counters use, so the pool resets when the allowance does. */
      (
        coalesce(public.config_bool('ad_repeat_same_day'), false)
        or (p_finished_at at time zone 'UTC')::date < public.utc_today()
      )
      /* And any longer interval the operator has asked for on top. */
      and (
        coalesce(public.config_int('ad_repeat_min_hours'), 0) <= 0
        or p_finished_at <= now() - make_interval(hours => public.config_int('ad_repeat_min_hours')::int)
      )
    );
$$;

revoke execute on function public.ad_repeat_ready(timestamptz) from public, anon;
grant execute on function public.ad_repeat_ready(timestamptz) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Both sides of the repeat rule, restated from the LIVE definitions
-- ---------------------------------------------------------------------------
--
-- ⚠️ `pg_get_functiondef` first, never the migration that created them.
-- Migration 180 exists because a function was rebuilt from its original and
-- lost a branch added later.

CREATE OR REPLACE FUNCTION public.get_ad_feed(p_user_id uuid, p_format ad_format DEFAULT NULL::ad_format, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, title text, description text, advertiser_name text, format ad_format, points_reward bigint, points_award bigint, video_source video_source, storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer, min_watch_seconds integer, question_count integer, graded_count integer, attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb, article_body text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller    uuid := (select auth.uid());
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
  v_repeating boolean;
  v_done      int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  /* ⚠️ NO `v_tier` HERE ANY MORE. One multiplier for the whole feed is exactly
     the bug: with stacked plans the rate depends on how many ads have already
     been watched today, so the feed quotes the rate of the NEXT one. */
  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();
  v_done := coalesce(v_done, 0);

  v_repeating := public.may_repeat_ads(p_user_id);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    a.points_reward,
    public.ad_reward_points(p_user_id, a.points_reward, v_done),
    a.video_source,
    a.storage_path,
    a.youtube_video_id,
    a.thumbnail_path,
    a.duration_seconds,
    a.min_watch_seconds,
    (select count(*)::int from public.ad_questions q where q.ad_id = a.id),
    (select count(*)::int
       from public.ad_questions q
      where q.ad_id = a.id
        and (
          q.correct_answer is not null
          or exists (select 1 from public.ad_question_options o
                      where o.question_id = q.id and o.is_correct)
        )),
    /* On a repeat the attempt counter starts again: the previous attempts
       belong to the completion that has already been paid, and carrying them
       forward would offer somebody an ad with no tries left. */
    case when v_repeating and coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 0 else coalesce(s.attempts_used, 0) end,
    case when v_repeating and coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then v_retry_cap else greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0) end,
    a.cta_label,
    a.cta_links,
    a.article_body
  from public.ads a
  join public.eligible_ad_ids(p_user_id) e on e.ad_id = a.id
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where (p_format is null or a.format = p_format)
    and (
      -- The ordinary case: anything not finished.
      coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
      or (
        /* The fallback: finished ads, but only when nothing else is left AND
           this one may come back. `ad_repeat_ready` owns that rule, and
           `register_ad_view` asks the same function, because a feed that hides
           an ad the write path still accepts is not a rule at all. */
        v_repeating
        and public.ad_repeat_ready(coalesce(s.completed_at, s.updated_at))
      )
    )
  order by
    /* Oldest finished first when repeating, so the ad somebody has just
       watched is the last one to come back. Null for every row in the
       ordinary case, which leaves the weighted draw below in charge. */
    case when v_repeating then coalesce(s.completed_at, s.updated_at) end asc nulls first,
    -ln(
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$function$;

revoke execute on function public.get_ad_feed(uuid, public.ad_format, integer) from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_ad_view(p_user_id uuid, p_ad_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ad     public.ads;
  v_state  public.user_ad_state;
  v_now    timestamptz := clock_timestamp();
  v_repeat boolean;
begin
  select * into v_ad
    from public.ads a
   where a.id = p_ad_id
     and a.status = 'active'
     and (a.starts_at is null or a.starts_at <= v_now)
     and (a.ends_at   is null or a.ends_at   >  v_now)
     and (a.max_completions is null or a.completions_count < a.max_completions);

  if not found then
    raise exception 'Ad is not available' using errcode = 'check_violation';
  end if;

  select * into v_state
    from public.user_ad_state s
   where s.user_id = p_user_id and s.ad_id = p_ad_id;

  if found and v_state.status in ('completed', 'failed_locked') then
    v_repeat := public.may_repeat_ads(p_user_id);

    if not v_repeat then
      raise exception 'Ad is closed for this user (%)', v_state.status
        using errcode = 'check_violation';
    end if;

    /* Not today, if it was finished today. One article was watched 17 times
       on 2026-08-12 because this asked only for an interval and the interval
       was zero. `ad_repeat_ready` is the same function the feed uses.

       Two reasons, two sentences: the day rule can be answered with "tomorrow"
       and an operator-set gap cannot, and a refusal that names the wrong wait
       is worse than a vague one. */
    if not public.ad_repeat_ready(coalesce(v_state.completed_at, v_state.updated_at)) then
      if not coalesce(public.config_bool('ad_repeat_same_day'), false)
         and (coalesce(v_state.completed_at, v_state.updated_at) at time zone 'UTC')::date
             >= public.utc_today() then
        raise exception 'This ad can be watched again tomorrow' using errcode = 'check_violation';
      end if;
      raise exception 'This ad can be watched again later' using errcode = 'check_violation';
    end if;

    update public.user_ad_state
       set status             = 'in_progress',
           attempts_used      = 0,
           watch_started_at   = v_now,
           watch_completed_at = null,
           completed_at       = null,
           locked_at          = null,
           updated_at         = now()
     where user_id = p_user_id and ad_id = p_ad_id;

    return v_now;
  end if;

  insert into public.user_ad_state (user_id, ad_id, status, watch_started_at)
  values (p_user_id, p_ad_id, 'in_progress', v_now)
  on conflict (user_id, ad_id) do update
    set watch_started_at   = v_now,
        watch_completed_at = null,
        updated_at         = now();

  return v_now;
end;
$function$;
