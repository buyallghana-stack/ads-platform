-- Applied directly to production on 2026-09-22 (dashboard), recorded here
-- verbatim from supabase_migrations.schema_migrations so the repo matches.
-- admin_save_ad: condition_mode is cast to question_condition_mode.

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
        coalesce(nullif(v_q ->> 'condition_mode', ''), 'all')::public.question_condition_mode
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

revoke execute on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[])
  to service_role;
