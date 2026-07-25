-- ============================================================================
-- Migration 046 — the admin side of the ad pool
--
-- Three functions the admin dashboard needs. An ad is not one row: it is an
-- ad, its questions, each question's options, the skip-logic rules between
-- them, and its tier targeting. Saving that from a form as five separate
-- round trips means a half-written ad the moment one of them fails, so the
-- whole thing goes in one transaction, one call.
--
-- Rules arrive referring to questions and options BY INDEX, because when an
-- ad is being created for the first time none of those rows have ids yet. The
-- function resolves indexes to ids after the inserts, in a second pass.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------
--
-- These run through the service client, where auth.uid() is null and
-- is_admin() therefore cannot be the check. The acting admin is named
-- explicitly and their role is verified here, so a compromised server action
-- still cannot edit the pool without a real admin id.

create or replace function public.assert_admin(p_admin_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_roles r
     where r.user_id = p_admin_id and r.role = 'admin'
  ) then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function public.assert_admin(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_save_ad — create or update a whole ad in one transaction
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_ad(
  p_admin_id  uuid,
  p_ad        jsonb,
  p_questions jsonb default '[]'::jsonb,
  p_tier_ids  uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := nullif(p_ad ->> 'id', '')::uuid;
  v_done    int := 0;
  v_q       jsonb;
  v_qid     uuid;
  v_oid     uuid;
  v_qids    uuid[] := '{}';
  v_opts    jsonb := '{}'::jsonb;   -- "questionIndex.optionIndex" -> option id
  v_rule    jsonb;
  v_dep     int;
  v_optix   int;
  i         int;
  j         int;
begin
  perform public.assert_admin(p_admin_id);

  if v_id is null then
    insert into public.ads (
      title, description, advertiser_name, format, status, points_reward,
      video_source, storage_path, youtube_video_id, thumbnail_path,
      duration_seconds, min_watch_seconds, max_completions, weight,
      starts_at, ends_at, created_by
    )
    values (
      p_ad ->> 'title',
      nullif(p_ad ->> 'description', ''),
      nullif(p_ad ->> 'advertiser_name', ''),
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
      p_admin_id
    )
    returning id into v_id;
  else
    update public.ads set
      title            = coalesce(p_ad ->> 'title', title),
      description      = nullif(p_ad ->> 'description', ''),
      advertiser_name  = nullif(p_ad ->> 'advertiser_name', ''),
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
      updated_at       = now()
    where id = v_id;

    if not found then
      raise exception 'Unknown ad' using errcode = 'check_violation';
    end if;
  end if;

  -- Targeting: no ids supplied means "everyone", which is the same as no rows.
  delete from public.ad_tiers where ad_id = v_id;
  if p_tier_ids is not null and array_length(p_tier_ids, 1) > 0 then
    insert into public.ad_tiers (ad_id, tier_id)
    select v_id, t from unnest(p_tier_ids) t
    on conflict do nothing;
  end if;

  -- ---------------------------------------------------------------------
  -- Questions
  -- ---------------------------------------------------------------------
  --
  -- Refused once anybody has completed the ad. Rewriting the questions under
  -- people who have already answered them silently rewrites what the
  -- advertiser's research says, and orphans the attempts that are the fraud
  -- evidence for those completions. Copy edits and scheduling stay editable;
  -- to change the questions, archive this ad and publish a new one.
  select completions_count into v_done from public.ads where id = v_id;

  if p_questions is not null and jsonb_array_length(p_questions) >= 0 then
    if v_done > 0 and exists (select 1 from public.ad_questions where ad_id = v_id) then
      -- Nothing to do: leave the existing questions exactly as they are.
      return v_id;
    end if;

    delete from public.ad_questions where ad_id = v_id;

    -- Pass 1: questions and their options.
    for i in 0 .. jsonb_array_length(p_questions) - 1 loop
      v_q := p_questions -> i;

      insert into public.ad_questions (
        ad_id, position, question_text, answer_format, correct_answer,
        show_at_seconds, condition_mode
      )
      values (
        v_id, i,
        v_q ->> 'question_text',
        (v_q ->> 'answer_format')::public.answer_format,
        nullif(v_q ->> 'correct_answer', ''),
        nullif(v_q ->> 'show_at_seconds', '')::int,
        coalesce((v_q ->> 'condition_mode')::public.question_condition_mode, 'all')
      )
      returning id into v_qid;

      v_qids := v_qids || v_qid;

      for j in 0 .. coalesce(jsonb_array_length(v_q -> 'options'), 0) - 1 loop
        insert into public.ad_question_options (question_id, option_text, is_correct, sort_order)
        values (
          v_qid,
          (v_q -> 'options' -> j) ->> 'option_text',
          coalesce(((v_q -> 'options' -> j) ->> 'is_correct')::boolean, false),
          j
        )
        returning id into v_oid;

        v_opts := v_opts || jsonb_build_object(i || '.' || j, v_oid);
      end loop;
    end loop;

    -- Pass 2: rules, now that every question and option has an id.
    for i in 0 .. jsonb_array_length(p_questions) - 1 loop
      v_q := p_questions -> i;
      for j in 0 .. coalesce(jsonb_array_length(v_q -> 'rules'), 0) - 1 loop
        v_rule := v_q -> 'rules' -> j;
        v_dep  := (v_rule ->> 'depends_on_index')::int;
        v_optix := nullif(v_rule ->> 'option_index', '')::int;

        insert into public.ad_question_rules (
          question_id, depends_on_question_id, option_id, value_text, negate
        )
        values (
          v_qids[i + 1],
          v_qids[v_dep + 1],
          -- The option belongs to the question being DEPENDED ON, so the
          -- index is scoped to that question, not this one.
          case when v_optix is null then null
               else (v_opts ->> (v_dep || '.' || v_optix))::uuid end,
          nullif(v_rule ->> 'value_text', ''),
          coalesce((v_rule ->> 'negate')::boolean, false)
        );
      end loop;
    end loop;
  end if;

  return v_id;
end;
$$;

comment on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[]) is
  'Creates or updates an ad with its questions, options, skip-logic rules and tier targeting in one transaction. Rules reference questions and options by index. Question structure is frozen once the ad has completions.';

revoke execute on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_delete_ad — remove from the pool without destroying evidence
-- ---------------------------------------------------------------------------
--
-- Every child of ads cascades: ad_questions, user_ad_state and ad_attempts all
-- go with it. ad_attempts is the fraud record for the people who watched, and
-- once anybody has been PAID for an ad, deleting it throws away the only
-- explanation of a ledger entry that still exists.
--
-- So a delete is only a delete while the ad is untouched. After that it is an
-- archive: gone from the pool forever, still on the record. The caller is told
-- which happened rather than being left to guess.

create or replace function public.admin_delete_ad(p_admin_id uuid, p_ad_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done     int;
  v_attempts int;
begin
  perform public.assert_admin(p_admin_id);

  select completions_count into v_done from public.ads where id = p_ad_id;
  if v_done is null then
    raise exception 'Unknown ad' using errcode = 'check_violation';
  end if;

  select count(*) into v_attempts from public.ad_attempts where ad_id = p_ad_id;

  if v_done = 0 and v_attempts = 0 then
    delete from public.ads where id = p_ad_id;
    return 'deleted';
  end if;

  update public.ads
     set status = 'archived', updated_at = now()
   where id = p_ad_id;
  return 'archived';
end;
$$;

comment on function public.admin_delete_ad(uuid, uuid) is
  'Removes an ad from the pool. Hard-deletes only while nobody has attempted it; otherwise archives, because ad_attempts is the evidence behind completions people were paid for. Returns which happened.';

revoke execute on function public.admin_delete_ad(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- admin_list_ads — the pool, with everything the list screen shows
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_ads(p_status public.ad_status default null)
returns table (
  id                uuid,
  title             text,
  advertiser_name   text,
  format            public.ad_format,
  status            public.ad_status,
  points_reward     bigint,
  completions_count int,
  max_completions   int,
  question_count    int,
  graded_count      int,
  branching_count   int,
  tier_slugs        text[],
  starts_at         timestamptz,
  ends_at           timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Read path: an admin's own browser token, so is_admin() is the check. A
  -- null caller is the service client, already trusted.
  if (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    a.id, a.title, a.advertiser_name, a.format, a.status, a.points_reward,
    a.completions_count, a.max_completions,
    (select count(*)::int from public.ad_questions q where q.ad_id = a.id),
    (select count(*)::int from public.ad_questions q
      where q.ad_id = a.id
        and (q.correct_answer is not null
             or exists (select 1 from public.ad_question_options o
                         where o.question_id = q.id and o.is_correct))),
    (select count(*)::int from public.ad_question_rules r
      join public.ad_questions q on q.id = r.question_id
     where q.ad_id = a.id),
    coalesce(
      (select array_agg(t.slug order by t.sort_order)
         from public.ad_tiers x join public.tiers t on t.id = x.tier_id
        where x.ad_id = a.id),
      '{}'::text[]
    ),
    a.starts_at, a.ends_at, a.created_at, a.updated_at
  from public.ads a
  where p_status is null or a.status = p_status
  order by a.created_at desc;
end;
$$;

comment on function public.admin_list_ads(public.ad_status) is
  'The ad pool for the admin list: counts of questions, graded questions and branching rules, plus the tiers each ad targets (empty = everyone).';

revoke execute on function public.admin_list_ads(public.ad_status) from public, anon;
grant execute on function public.admin_list_ads(public.ad_status) to authenticated, service_role;
