-- ============================================================================
-- Migration 238 — an ad can carry the advertiser's logo
--
-- Every ad card, player and article header drew the advertiser as a blue
-- square with the first letter of their name in it. That is a sensible
-- fallback and a poor default: a real company has a mark, and the card is the
-- one place a viewer decides whether the thing in front of them is worth two
-- minutes.
--
-- WHY THE COLUMN IS ON `ads` AND NOT ON `advertisers`
-- `advertisers` is the CONTRACT book — who is paying, how much, and what has
-- been delivered against it. It looks like the natural home for a logo until
-- you check what is in it: on production today there are zero advertiser rows
-- and all three ads have `advertiser_id is null`, because the ad editor has
-- no advertiser picker and the only thing that ever set that column was a
-- one-off backfill in migration 055. A logo hung off `advertisers` would
-- therefore never appear on anything, and making it appear would mean
-- building a linking UI first.
--
-- The label a viewer actually sees is `ads.advertiser_name`, keyed in on the
-- ad. The logo belongs beside the thing it labels.
--
-- BANDWIDTH, BECAUSE IT WAS ASKED BEFORE THIS WAS BUILT
-- The `ad-media` bucket averages 2.5 MB an object today (the films). A logo
-- is compressed in the browser to a 96 px square WebP before it is uploaded —
-- the same trick the avatars use, which measured 7 KB each on this project —
-- so one is roughly a quarter of one percent of a single video watch, it is
-- fetched lazily so only cards on screen pay for it, and the browser caches
-- it across the whole feed when several ads share an advertiser. In the same
-- release user profile photos stop being downloaded at all, and those were
-- fetched once per ROW on the leaderboard, the team screen and three admin
-- tables. Net traffic goes down.
--
-- The ceiling is not trusted to the operator's choice of file: the browser
-- resizes before uploading, the uploader refuses anything over 200 KB that
-- survived that, and the `ad-media` bucket's own mime list already refuses
-- anything that is not jpeg, png or webp.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.ads
  add column if not exists advertiser_logo_path text;

comment on column public.ads.advertiser_logo_path is
  'Object key in the ad-media bucket for the advertiser''s logo, under logo/. Null draws the initial instead, which stays the fallback rather than becoming an error state.';


-- ---------------------------------------------------------------------------
-- 2. admin_save_ad — write it
-- ---------------------------------------------------------------------------
--
-- Reproduced in full from migration 197 with `advertiser_logo_path` added to
-- the insert and the update. Nothing else changes.

CREATE OR REPLACE FUNCTION public.admin_save_ad(p_admin_id uuid, p_ad jsonb, p_questions jsonb DEFAULT '[]'::jsonb, p_tier_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id      uuid := nullif(p_ad ->> 'id', '')::uuid;
  v_done    int := 0;
  v_q       jsonb;
  v_qid     uuid;
  v_oid     uuid;
  v_qids    uuid[] := '{}';
  v_opts    jsonb := '{}'::jsonb;
  v_rule    jsonb;
  v_dep     int;
  v_optix   int;
  i         int;
  j         int;
begin
  perform public.assert_admin_area(p_admin_id, 'ads');

  if v_id is null then
    insert into public.ads (
      title, description, advertiser_name, advertiser_logo_path, format, status, points_reward,
      video_source, storage_path, youtube_video_id, thumbnail_path,
      duration_seconds, min_watch_seconds, max_completions, weight,
      starts_at, ends_at, cta_label, cta_links, article_body, created_by
    )
    values (
      p_ad ->> 'title',
      nullif(p_ad ->> 'description', ''),
      nullif(p_ad ->> 'advertiser_name', ''),
      nullif(p_ad ->> 'advertiser_logo_path', ''),
      (p_ad ->> 'format')::public.ad_format,
      coalesce((p_ad ->> 'status')::public.ad_status, 'draft'),
      (p_ad ->> 'points_reward')::bigint,
      nullif(p_ad ->> 'video_source', '')::public.video_source,
      nullif(p_ad ->> 'storage_path', ''),
      nullif(p_ad ->> 'youtube_video_id', ''),
      nullif(p_ad ->> 'thumbnail_path', ''),
      nullif(p_ad ->> 'duration_seconds', '')::int,
      nullif(p_ad ->> 'min_watch_seconds', '')::int,
      nullif(p_ad ->> 'max_completions', '')::int,
      coalesce(nullif(p_ad ->> 'weight', '')::int, 100),
      nullif(p_ad ->> 'starts_at', '')::timestamptz,
      nullif(p_ad ->> 'ends_at', '')::timestamptz,
      nullif(p_ad ->> 'cta_label', ''),
      coalesce(p_ad -> 'cta_links', '[]'::jsonb),
      nullif(btrim(p_ad ->> 'article_body'), ''),
      p_admin_id
    )
    returning id into v_id;
  else
    update public.ads set
      title            = coalesce(p_ad ->> 'title', title),
      description      = nullif(p_ad ->> 'description', ''),
      advertiser_name  = nullif(p_ad ->> 'advertiser_name', ''),
      advertiser_logo_path = nullif(p_ad ->> 'advertiser_logo_path', ''),
      status           = coalesce((p_ad ->> 'status')::public.ad_status, status),
      points_reward    = coalesce((p_ad ->> 'points_reward')::bigint, points_reward),
      video_source     = nullif(p_ad ->> 'video_source', '')::public.video_source,
      storage_path     = nullif(p_ad ->> 'storage_path', ''),
      youtube_video_id = nullif(p_ad ->> 'youtube_video_id', ''),
      thumbnail_path   = nullif(p_ad ->> 'thumbnail_path', ''),
      duration_seconds = nullif(p_ad ->> 'duration_seconds', '')::int,
      min_watch_seconds= nullif(p_ad ->> 'min_watch_seconds', '')::int,
      max_completions  = nullif(p_ad ->> 'max_completions', '')::int,
      weight           = coalesce(nullif(p_ad ->> 'weight', '')::int, weight),
      starts_at        = nullif(p_ad ->> 'starts_at', '')::timestamptz,
      ends_at          = nullif(p_ad ->> 'ends_at', '')::timestamptz,
      cta_label        = nullif(p_ad ->> 'cta_label', ''),
      cta_links        = coalesce(p_ad -> 'cta_links', '[]'::jsonb),
      article_body     = nullif(btrim(p_ad ->> 'article_body'), ''),
      updated_at       = now()
    where id = v_id;

    if not found then
      raise exception 'Unknown ad' using errcode = 'check_violation';
    end if;
  end if;

  delete from public.ad_tiers where ad_id = v_id;
  if p_tier_ids is not null and array_length(p_tier_ids, 1) > 0 then
    insert into public.ad_tiers (ad_id, tier_id)
    select v_id, t from unnest(p_tier_ids) t
    on conflict do nothing;
  end if;

  select completions_count into v_done from public.ads where id = v_id;

  if p_questions is not null and jsonb_array_length(p_questions) >= 0 then
    if v_done > 0 and exists (select 1 from public.ad_questions where ad_id = v_id) then
      return v_id;
    end if;

    delete from public.ad_questions where ad_id = v_id;

    for i in 0 .. jsonb_array_length(p_questions) - 1 loop
      v_q := p_questions -> i;

      insert into public.ad_questions (
        ad_id, position, question_text, answer_format, correct_answer,
        show_at_seconds, condition_mode
      )
      values (
        v_id, i + 1,
        v_q ->> 'question_text',
        (v_q ->> 'answer_format')::public.answer_format,
        nullif(v_q ->> 'correct_answer', ''),
        nullif(v_q ->> 'show_at_seconds', '')::int,
        coalesce(nullif(v_q ->> 'condition_mode', ''), 'all')::public.condition_mode
      )
      returning id into v_qid;

      v_qids := v_qids || v_qid;

      if v_q -> 'options' is not null then
        for j in 0 .. jsonb_array_length(v_q -> 'options') - 1 loop
          insert into public.ad_question_options (question_id, option_text, is_correct, sort_order)
          values (
            v_qid,
            (v_q -> 'options' -> j) ->> 'option_text',
            coalesce(((v_q -> 'options' -> j) ->> 'is_correct')::boolean, false),
            j + 1
          )
          returning id into v_oid;

          v_opts := jsonb_set(v_opts, array[i::text, j::text], to_jsonb(v_oid::text), true);
        end loop;
      end if;
    end loop;

    -- Rules in a second pass: a rule names another question by INDEX, and
    -- every index has to exist before any of them can be resolved.
    for i in 0 .. jsonb_array_length(p_questions) - 1 loop
      v_q := p_questions -> i;
      if v_q -> 'rules' is null then continue; end if;

      for j in 0 .. jsonb_array_length(v_q -> 'rules') - 1 loop
        v_rule := (v_q -> 'rules') -> j;
        v_dep  := (v_rule ->> 'depends_on_index')::int;
        v_optix := nullif(v_rule ->> 'option_index', '')::int;

        insert into public.ad_question_rules (
          question_id, depends_on_question_id, option_id, value_text, negate
        )
        values (
          v_qids[i + 1],
          v_qids[v_dep + 1],
          case when v_optix is null then null
               else (v_opts -> v_dep::text ->> v_optix::text)::uuid end,
          nullif(v_rule ->> 'value_text', ''),
          coalesce((v_rule ->> 'negate')::boolean, false)
        );
      end loop;
    end loop;
  end if;

  return v_id;
end;
$function$;

-- ⚠️ A replace re-grants EXECUTE to PUBLIC. This one writes the answer key.
revoke execute on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[])
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. get_ad_feed — hand the logo to the card
-- ---------------------------------------------------------------------------
--
-- DROP and CREATE, not REPLACE: the return type gains a column and Postgres
-- refuses to replace a set-returning function whose OUT parameters changed.
--
-- Reproduced in full from migration 222. The only change is
-- `a.advertiser_logo_path` selected beside `a.advertiser_name`.

drop function if exists public.get_ad_feed(uuid, public.ad_format, integer);

CREATE FUNCTION public.get_ad_feed(p_user_id uuid, p_format ad_format DEFAULT NULL::ad_format, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, title text, description text, advertiser_name text, advertiser_logo_path text, format ad_format, points_reward bigint, points_award bigint, video_source video_source, storage_path text, youtube_video_id text, thumbnail_path text, duration_seconds integer, min_watch_seconds integer, question_count integer, graded_count integer, attempts_used integer, attempts_remaining integer, cta_label text, cta_links jsonb, article_body text)
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
    a.advertiser_logo_path,
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
           also requires that nothing fresh is left. */
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
$function$;

/* ⚠️ A DROP puts the function back at PUBLIC on re-create, which is worse than
   a replace: the anon key would reach it. The feed is per user and carries its
   own caller check, so the grants are restored to exactly what they were. */
revoke execute on function public.get_ad_feed(uuid, public.ad_format, integer)
  from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, integer)
  to authenticated, service_role;
