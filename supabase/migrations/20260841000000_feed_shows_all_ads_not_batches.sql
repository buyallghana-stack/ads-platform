-- ============================================================================
-- Migration 193 — the feed shows everything, not in batches
--
-- BUG: When a user holds stacked plans (e.g. Bronze 5 + Silver 2 = 7 daily),
-- and only 5 fresh ads exist, the feed shows the 5 fresh ads first.  After
-- completing all 5, `may_repeat_ads` flips to true and the same 5 come back
-- as repeats, but `remainingToday` is now 2, so only 2 are shown.
--
-- The user perceives this as "ads arrive in batches" — first 5, then 2 —
-- rather than seeing all 7 at once.  The root cause is that `may_repeat_ads`
-- is an ALL-OR-NOTHING gate: while even one fresh ad exists, every completed
-- ad is hidden from the feed.
--
-- FIX: Remove the `v_repeating` gate from the WHERE clause entirely.  Instead,
-- each completed ad individually checks `ad_repeat_ready` and appears in the
-- feed alongside fresh ads when it qualifies.  The `ad_repeat_when_exhausted`
-- config is still honoured — but PER AD, not as a binary switch for the whole
-- feed.
--
-- The `may_repeat_ads` RPC is kept for the UI's "repeating" banner (which
-- tells the user they are seeing previously-watched ads), and the frontend
-- `remainingToday` cap still limits how many cards are shown.
--
-- `register_ad_view` already calls `may_repeat_ads` and `ad_repeat_ready`
-- independently, so the write path does not need to change — it already
-- accepts any ad that passes `ad_repeat_ready` when repeats are enabled.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_ad_feed — completed ads now appear alongside fresh ones
-- ---------------------------------------------------------------------------
--
-- Restated from `pg_get_functiondef` of the LIVE function (migration 192),
-- with ONE change: the WHERE clause no longer gates completed ads behind
-- `v_repeating`.  A completed ad appears when:
--   1. `ad_repeat_when_exhausted` is on (checked via `config_bool`), AND
--   2. `ad_repeat_ready(completed_at)` says enough time has passed.
--
-- Fresh (uncompleted) ads always appear, exactly as before.

CREATE OR REPLACE FUNCTION public.get_ad_feed(p_user_id uuid, p_format ad_format DEFAULT NULL::ad_format, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, title text, description text, advertiser_name text, format ad_format, points_reward bigint, points_award bigint, video_source video_source, storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer, min_watch_seconds integer, question_count integer, graded_count integer, attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb, article_body text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller      uuid := (select auth.uid());
  v_retry_cap   int := public.config_int('ad_retry_cap')::int;
  v_repeating   boolean;
  v_repeat_on   boolean;
  v_done        int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(d.ads_completed, 0) into v_done
    from public.daily_earning_counters d
   where d.user_id = p_user_id and d.day = public.utc_today();
  v_done := coalesce(v_done, 0);

  /* Whether to show the "you are seeing repeats" banner.  Still the
     all-or-nothing check, because the banner makes sense only when the ENTIRE
     feed is repeats — if fresh ads are mixed in, the banner is confusing. */
  v_repeating := public.may_repeat_ads(p_user_id);

  /* Whether repeating is enabled AT ALL.  This is the config switch, not the
     per-user exhaustion check.  An ad that has been completed can reappear
     only when the operator has turned this on. */
  v_repeat_on := coalesce(public.config_bool('ad_repeat_when_exhausted'), false);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    public.base_ad_points(),
    public.ad_reward_points(p_user_id, public.base_ad_points(), v_done),
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
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 0 else coalesce(s.attempts_used, 0) end,
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
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
      -- Fresh ads: anything not finished.  Always shown.
      coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
      or (
        /* ⚠️ CHANGED (migration 193): completed ads now appear alongside fresh
           ones rather than waiting for the feed to be entirely exhausted.
           The two conditions are:
             1. The repeat config is on.
             2. This specific ad has waited long enough (ad_repeat_ready).
           Previously this also required `v_repeating` (= no fresh ads left),
           which caused the batching bug. */
        v_repeat_on
        and public.ad_repeat_ready(coalesce(s.completed_at, s.updated_at))
      )
    )
  order by
    /* Fresh ads first, then repeats — so a user sees new content before
       anything they have already watched.  Within each group the weighted
       random draw decides. */
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then 1 else 0 end,
    case when coalesce(s.status, 'in_progress') in ('completed', 'failed_locked')
         then coalesce(s.completed_at, s.updated_at) end asc nulls first,
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
