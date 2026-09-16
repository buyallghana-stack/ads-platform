-- ============================================================================
-- Migration 222 — the feed and the watch agree about repeats
--
-- `get_ad_feed` decided whether to put a finished ad back using
-- `config_bool('ad_repeat_when_exhausted')` on its own. `register_ad_view`
-- decided using `may_repeat_ads`, which is that same flag AND the condition it
-- is named after: nothing fresh left to watch.
--
-- So an ad finished yesterday reappeared in the feed while unwatched ads were
-- still sitting in it, and tapping it raised. From the user's side that is an
-- ad that does nothing when pressed.
--
-- The odd part is that the feed already COMPUTED the right answer, into
-- `v_repeating`, one line above the flag it used instead, and then never read
-- it. Nothing else changes here: same signature, same ordering, same columns.
--
-- Caught by tests/money/ad-repeats.test.ts, "does not repeat while there is
-- anything else to watch", whose own header says the two sides must ask the
-- same function. They did not.
-- ============================================================================

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

  v_repeating := public.may_repeat_ads(p_user_id);

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    public.base_ad_points(),
    -- ⚠️ Pass a.id so each ad reflects its own plan bucket valuation
    public.ad_reward_points(p_user_id, a.id, public.base_ad_points(), v_done),
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
      coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
      or (
        /* ⚠️ `v_repeating`, NOT the raw config flag. The flag only says the
           fallback EXISTS; `may_repeat_ads` says it is open right now, which
           also requires that nothing fresh is left. Reading the flag alone put
           a finished ad back in the feed while unwatched ones sat below it,
           and `register_ad_view` then refused the tap, because it has always
           asked `may_repeat_ads`. A listing that offers what the watch refuses
           is a dead tap: the user presses an ad and nothing happens. */
        v_repeating
        and public.ad_repeat_ready(coalesce(s.completed_at, s.updated_at))
      )
    )
  order by
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
$function$
;

/* ⚠️ A replace re-grants EXECUTE to PUBLIC. The feed is per user and carries
   its own caller check, so the grants are restored to exactly what they were:
   authenticated and service_role, nothing wider. */
revoke execute on function public.get_ad_feed(uuid, public.ad_format, integer)
  from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, integer)
  to authenticated, service_role;
