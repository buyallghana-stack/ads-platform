-- ============================================================================
-- Migration 048 — a call to action on video ads
--
-- Operator: "add call to action to screens for video ad. these are maybe the
-- links, advertisers contact information, social media handles, or websites
-- if they have i can place them there. survey should not have any call to
-- action."
--
-- WHY ONE JSONB COLUMN RATHER THAN A COLUMN PER CHANNEL
-- An advertiser might give a website and nothing else, or a WhatsApp number
-- and two social handles. A column each (website/whatsapp/instagram/tiktok/…)
-- means a migration every time a new channel matters, and a row full of
-- nulls in the ordinary case. A small ordered list says exactly what the
-- advertiser supplied, in the order the operator wants it shown, and the
-- FIRST entry is the primary button.
--
-- The value is stored as the advertiser gave it — a handle, a number, a URL.
-- Turning it into a link is the application's job (src/lib/ads/cta.ts), for
-- one reason that matters: a stored href is a stored `javascript:` waiting to
-- happen. Building the href from a known channel and a validated value means
-- the database can never hold a link this product would follow.
--
-- SURVEYS CARRY NONE, and that is a constraint rather than a convention —
-- a survey is research, and pushing the respondent to the advertiser's shop
-- in the middle of it changes what the answers mean.
-- ============================================================================


alter table public.ads
  add column cta_label text,
  add column cta_links jsonb not null default '[]'::jsonb;

comment on column public.ads.cta_label is
  'Text on the primary call-to-action button ("Shop now"). Null falls back to a per-channel default in the player.';

comment on column public.ads.cta_links is
  'Ordered list of {kind, value} the advertiser supplied — website, whatsapp, phone, email or a social handle. The first is the primary button, the rest are icon links. Values are stored raw and turned into hrefs by the application, never stored as hrefs.';

alter table public.ads
  add constraint ads_cta_label_length check (
    cta_label is null or length(trim(cta_label)) between 2 and 40
  );

alter table public.ads
  add constraint ads_cta_shape check (
    jsonb_typeof(cta_links) = 'array' and jsonb_array_length(cta_links) <= 6
  );

-- Video only. A survey with a call to action is not a survey.
alter table public.ads
  add constraint ads_cta_video_only check (
    format = 'video' or (cta_links = '[]'::jsonb and cta_label is null)
  );


-- ---------------------------------------------------------------------------
-- admin_save_ad — same function, now writing the call to action
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
      starts_at, ends_at, cta_label, cta_links, created_by
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
      nullif(p_ad ->> 'cta_label', ''),
      coalesce(p_ad -> 'cta_links', '[]'::jsonb),
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
      cta_label        = nullif(p_ad ->> 'cta_label', ''),
      cta_links        = coalesce(p_ad -> 'cta_links', '[]'::jsonb),
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

  -- Questions are frozen once anybody has completed the ad: rewriting them
  -- under people who already answered rewrites the advertiser's research and
  -- orphans the attempts behind paid completions.
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

revoke execute on function public.admin_save_ad(uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- get_ad_feed — carries the call to action to the player
-- ---------------------------------------------------------------------------
--
-- Return type changes, so drop and recreate. Everything else is migration
-- 043's function verbatim.

drop function if exists public.get_ad_feed(uuid, public.ad_format, int);

create function public.get_ad_feed(
  p_user_id uuid,
  p_format  public.ad_format default null,
  p_limit   int default 40
)
returns table (
  id                 uuid,
  title              text,
  description        text,
  advertiser_name    text,
  format             public.ad_format,
  points_reward      bigint,
  points_award       bigint,
  video_source       public.video_source,
  storage_path       text,
  youtube_video_id   text,
  thumbnail_path     text,
  duration_seconds   int,
  min_watch_seconds  int,
  question_count     int,
  graded_count       int,
  attempts_used      int,
  attempts_remaining int,
  cta_label          text,
  cta_links          jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller    uuid := (select auth.uid());
  v_tier      public.tiers;
  v_retry_cap int := public.config_int('ad_retry_cap')::int;
  v_inclusive boolean := public.config_bool('ad_targeting_includes_lower_tiers');
  v_tier_ids  uuid[];
  v_rank      int;
begin
  if v_caller is not null and v_caller <> p_user_id and not public.is_admin() then
    raise exception 'Not authorised to read another user''s ad feed'
      using errcode = 'insufficient_privilege';
  end if;

  v_tier := public.resolve_user_tier(p_user_id);

  select array_agg(t.tier_id), max(t.sort_order)
    into v_tier_ids, v_rank
    from public.user_target_tiers(p_user_id) t;

  return query
  select
    a.id,
    a.title,
    a.description,
    a.advertiser_name,
    a.format,
    a.points_reward,
    greatest(floor(a.points_reward * v_tier.reward_multiplier)::bigint, 1),
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
    coalesce(s.attempts_used, 0),
    greatest(v_retry_cap - coalesce(s.attempts_used, 0), 0),
    a.cta_label,
    a.cta_links
  from public.ads a
  left join public.user_ad_state s
    on s.user_id = p_user_id and s.ad_id = a.id
  where a.status = 'active'
    and (p_format is null or a.format = p_format)
    and (a.starts_at is null or a.starts_at <= now())
    and (a.ends_at   is null or a.ends_at   >  now())
    and (a.max_completions is null or a.completions_count < a.max_completions)
    and coalesce(s.status, 'in_progress') not in ('completed', 'failed_locked')
    and (
      not exists (select 1 from public.ad_tiers x where x.ad_id = a.id)
      or (
        case
          when v_inclusive then
            coalesce((
              select min(t2.sort_order)
              from public.ad_tiers x
              join public.tiers t2 on t2.id = x.tier_id
              where x.ad_id = a.id
            ), 0) <= coalesce(v_rank, 0)
          else
            exists (
              select 1 from public.ad_tiers x
              where x.ad_id = a.id and x.tier_id = any (v_tier_ids)
            )
        end
      )
    )
  order by
    -ln(
      (abs(hashtextextended(
             p_user_id::text || a.id::text || public.utc_today()::text, 0
           )) % 1000000 + 1)::numeric / 1000001.0
    ) / a.weight
  limit greatest(p_limit, 1);
end;
$$;

comment on function public.get_ad_feed(uuid, public.ad_format, int) is
  'The whole ads tab in one call: eligible ads for this user, tier-adjusted reward, media, question counts and the advertiser''s call to action. Weighted draw seeded on user+ad+day so the order is stable for a day.';

revoke execute on function public.get_ad_feed(uuid, public.ad_format, int) from public, anon;
grant execute on function public.get_ad_feed(uuid, public.ad_format, int) to authenticated, service_role;
